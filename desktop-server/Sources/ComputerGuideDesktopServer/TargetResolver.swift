import AppKit
@preconcurrency import AXorcist
import Foundation
import PeekabooAutomationKit
import PeekabooFoundation

@MainActor
final class TargetResolver {
    private struct Candidate {
        let element: ResolvedElement
        let score: Int
    }

    private let applicationService: ApplicationService
    private let detectionService: ElementDetectionService
    private let snapshotManager: SnapshotManager
    private let maxDepth = 10
    private let maxNodes = 500

    init(
        applicationService: ApplicationService,
        detectionService: ElementDetectionService,
        snapshotManager: SnapshotManager)
    {
        self.applicationService = applicationService
        self.detectionService = detectionService
        self.snapshotManager = snapshotManager
    }

    func resolve(description: String, intent: TargetIntent, context: TargetContext) async throws -> ResolvedElement {
        if let snapshotID = Self.normalized(context.snapshotID),
           let elementID = Self.normalized(context.elementID)
        {
            return try await self.resolveFromSnapshot(
                snapshotID: snapshotID,
                elementID: elementID,
                fallbackDescription: Self.normalized(description),
                context: context)
        }

        let query = Self.normalized(description)
        guard let query else {
            throw DesktopServerError.invalidInput("Target description must not be empty unless snapshot_id and element_id are provided")
        }

        let searchRoot = try await self.resolveSearchRoot(app: context.app, windowTitle: context.windowTitle)
        let app = searchRoot.app
        guard let app else {
            throw DesktopServerError.serverUnavailable("Failed to resolve the frontmost application")
        }

        let appElement = AXApp(app).element
        let windowElement = searchRoot.window ?? appElement.focusedWindow() ?? appElement.mainWindow() ?? appElement.windows()?.first
        let windowTitle = searchRoot.windowTitle ?? windowElement?.title()
        let appName = app.localizedName ?? app.bundleIdentifier ?? searchRoot.appName

        var candidates: [Candidate] = []
        var visited = 0

        if let windowElement {
            self.walk(
                element: windowElement,
                depth: 0,
                visited: &visited,
                appName: appName,
                windowTitle: windowTitle,
                query: query,
                intent: intent,
                windowFrame: windowElement.frame(),
                candidates: &candidates)
        }

        if candidates.isEmpty {
            self.walk(
                element: appElement,
                depth: 0,
                visited: &visited,
                appName: appName,
                windowTitle: windowTitle,
                query: query,
                intent: intent,
                windowFrame: windowElement?.frame(),
                candidates: &candidates)
        }

        let sorted = candidates.sorted { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            if lhs.element.bounds.minY != rhs.element.bounds.minY { return lhs.element.bounds.minY < rhs.element.bounds.minY }
            return lhs.element.bounds.minX < rhs.element.bounds.minX
        }

        guard let best = sorted.first else {
            throw DesktopServerError.targetNotFound(
                "Could not resolve a target matching '\(query)' in \(appName)")
        }

        if sorted.count > 1, (best.score - sorted[1].score) < 25 {
            let labels = Array(sorted.prefix(3)).map {
                Self.candidateSummary(for: $0.element, score: $0.score)
            }
            throw DesktopServerError.targetAmbiguous(
                "Multiple targets match '\(query)'. Refine the description with more visible text or location details.",
                labels)
        }

        return best.element
    }

    private func resolveFromSnapshot(
        snapshotID: String,
        elementID: String,
        fallbackDescription: String?,
        context _: TargetContext) async throws -> ResolvedElement
    {
        guard let detectionResult = try await self.snapshotManager.getDetectionResult(snapshotId: snapshotID) else {
            throw DesktopServerError.targetNotFound("Snapshot '\(snapshotID)' could not be found")
        }
        guard let detectedElement = detectionResult.elements.findById(elementID) else {
            throw DesktopServerError.targetNotFound("Element '\(elementID)' was not found in snapshot '\(snapshotID)'")
        }

        let snapshot = try await self.snapshotManager.getUIAutomationSnapshot(snapshotId: snapshotID)
        let label = Self.preferredResolvedLabel(
            title: detectedElement.attributes["title"],
            label: detectedElement.label,
            identifier: detectedElement.attributes["identifier"],
            descriptionText: detectedElement.attributes["description"],
            roleDescription: detectedElement.attributes["roleDescription"],
            value: detectedElement.value,
            fallback: fallbackDescription ?? elementID)

        return ResolvedElement(
            appName: snapshot?.applicationName,
            windowTitle: snapshot?.windowTitle,
            elementID: detectedElement.id,
            elementType: detectedElement.type.rawValue,
            label: label,
            bounds: detectedElement.bounds)
    }

    private func resolveSearchRoot(app targetApp: String?, windowTitle targetWindowTitle: String?) async throws
        -> (app: NSRunningApplication?, window: Element?, appName: String, windowTitle: String?)
    {
        if let targetApp = Self.normalized(targetApp) {
            let appInfo = try await self.applicationService.findApplication(identifier: targetApp)
            let app = NSRunningApplication(processIdentifier: appInfo.processIdentifier)
            guard let app else {
                throw DesktopServerError.serverUnavailable("Failed to resolve application '\(targetApp)'")
            }

            let appElement = AXApp(app).element
            let window = self.resolveWindow(in: appElement, windowTitle: targetWindowTitle)
            return (
                app: app,
                window: window,
                appName: app.localizedName ?? app.bundleIdentifier ?? appInfo.name,
                windowTitle: window?.title() ?? Self.normalized(targetWindowTitle))
        }

        let frontmostApp = try await self.applicationService.getFrontmostApplication()
        let app = NSRunningApplication(processIdentifier: frontmostApp.processIdentifier)
        return (
            app: app,
            window: nil,
            appName: frontmostApp.name,
            windowTitle: nil)
    }

    private func resolveWindow(in appElement: Element, windowTitle targetWindowTitle: String?) -> Element? {
        let windows = appElement.windows() ?? []
        guard let targetWindowTitle = Self.normalized(targetWindowTitle), !windows.isEmpty else {
            return appElement.focusedWindow() ?? appElement.mainWindow() ?? windows.first
        }

        if let exactWindow = windows.first(where: {
            Self.normalize($0.title() ?? "").contains(targetWindowTitle)
        }) {
            return exactWindow
        }

        return appElement.focusedWindow() ?? appElement.mainWindow() ?? windows.first
    }

    private func walk(
        element: Element,
        depth: Int,
        visited: inout Int,
        appName: String,
        windowTitle: String?,
        query: String,
        intent: TargetIntent,
        windowFrame: CGRect?,
        candidates: inout [Candidate])
    {
        guard depth <= self.maxDepth, visited < self.maxNodes else { return }
        visited += 1

        let role = element.role() ?? "AXUnknown"
        let frame = element.frame() ?? .zero
        let title = element.title()
        let label = element.label()
        let value = element.stringValue()
        let identifier = element.identifier()
        let descriptionText = element.descriptionText()
        let help = element.help()
        let roleDescription = element.roleDescription()

        let score = self.score(
            query: query,
            title: title,
            label: label,
            value: value,
            identifier: identifier,
            descriptionText: descriptionText,
            help: help,
            roleDescription: roleDescription,
            role: role,
            frame: frame,
            windowFrame: windowFrame,
            intent: intent)

        if score > 0, frame.width > 1, frame.height > 1 {
            let resolved = ResolvedElement(
                appName: appName,
                windowTitle: windowTitle,
                elementID: identifier ?? UUID().uuidString,
                elementType: role,
                label: Self.preferredResolvedLabel(
                    title: title,
                    label: label,
                    identifier: identifier,
                    descriptionText: descriptionText,
                    roleDescription: roleDescription,
                    value: value,
                    fallback: nil),
                bounds: frame)
            candidates.append(Candidate(element: resolved, score: score))
        }

        for child in element.children() ?? [] {
            self.walk(
                element: child,
                depth: depth + 1,
                visited: &visited,
                appName: appName,
                windowTitle: windowTitle,
                query: query,
                intent: intent,
                windowFrame: windowFrame,
                candidates: &candidates)
        }
    }

    private func score(
        query: String,
        title: String?,
        label: String?,
        value: String?,
        identifier: String?,
        descriptionText: String?,
        help: String?,
        roleDescription: String?,
        role: String,
        frame: CGRect,
        windowFrame: CGRect?,
        intent: TargetIntent) -> Int
    {
        let normalizedQuery = Self.normalize(query)
        var score = 0
        let tokens = normalizedQuery.split(separator: " ").map(String.init)
        score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: title, exact: 420, contains: 260, token: 55)
        score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: label, exact: 360, contains: 240, token: 50)
        score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: identifier, exact: 280, contains: 180, token: 35)
        score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: descriptionText, exact: 220, contains: 160, token: 28)
        score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: help, exact: 140, contains: 100, token: 18)
        score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: roleDescription, exact: 80, contains: 60, token: 12)

        if let normalizedValue = Self.searchableValue(value) {
            score += self.weightedTextScore(query: normalizedQuery, tokens: tokens, value: normalizedValue, exact: 60, contains: 45, token: 8, normalized: true)
        }

        let normalizedRole = Self.normalize(role)
        switch intent {
        case .click, .drag:
            if normalizedRole.contains("button") || normalizedRole.contains("link") {
                score += 20
            }
        case .type:
            if normalizedRole.contains("textfield") || normalizedRole.contains("textarea") || normalizedRole.contains("searchfield") {
                score += 120
            }
        case .scroll:
            if normalizedRole.contains("scroll") || normalizedRole.contains("list") || normalizedRole.contains("table") || normalizedRole.contains("outline") || normalizedRole.contains("text") {
                score += 80
            }
        }

        if let windowFrame {
            let queryTokens = Set(tokens)
            if queryTokens.contains("top"), frame.midY < windowFrame.midY { score += 24 }
            if queryTokens.contains("bottom"), frame.midY > windowFrame.midY { score += 24 }
            if queryTokens.contains("left"), frame.midX < windowFrame.midX { score += 18 }
            if queryTokens.contains("right"), frame.midX > windowFrame.midX { score += 18 }
            if queryTokens.contains("center") || queryTokens.contains("middle") {
                let dx = abs(frame.midX - windowFrame.midX)
                let dy = abs(frame.midY - windowFrame.midY)
                score += max(0, 30 - Int((dx + dy) / 40))
            }
        }

        return score
    }

    private func weightedTextScore(
        query: String,
        tokens: [String],
        value: String?,
        exact: Int,
        contains: Int,
        token: Int,
        normalized: Bool = false) -> Int
    {
        let normalizedValue = normalized ? value : Self.normalized(value)
        guard let normalizedValue, !normalizedValue.isEmpty else { return 0 }

        var score = 0
        if normalizedValue == query { score += exact }
        if normalizedValue.contains(query) { score += contains }

        for queryToken in tokens where normalizedValue.contains(queryToken) {
            score += token
        }

        if normalizedValue.count > 180 {
            score -= 80
        } else if normalizedValue.count > 120 {
            score -= 30
        }

        return max(score, 0)
    }

    private static func searchableValue(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard !trimmed.contains("\n"), trimmed.count <= 120 else { return nil }
        return Self.normalize(trimmed)
    }

    private static func preferredResolvedLabel(
        title: String?,
        label: String?,
        identifier: String?,
        descriptionText: String?,
        roleDescription: String?,
        value: String?,
        fallback: String?) -> String?
    {
        let candidates = [
            title,
            label,
            identifier,
            descriptionText,
            roleDescription,
            Self.compactValueLabel(value),
            fallback,
        ]
        for candidate in candidates {
            if let candidate = Self.compactLabel(candidate) {
                return candidate
            }
        }
        return nil
    }

    private static func compactValueLabel(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("\n"), trimmed.count <= 80 else { return nil }
        return trimmed
    }

    private static func compactLabel(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.count <= 120 {
            return trimmed
        }
        let end = trimmed.index(trimmed.startIndex, offsetBy: 117)
        return String(trimmed[..<end]) + "..."
    }

    private static func candidateSummary(for element: ResolvedElement, score: Int) -> String {
        let label = element.label ?? element.elementID
        let app = element.appName ?? "unknown app"
        let window = element.windowTitle ?? "unknown window"
        let bounds = element.bounds
        return "\(label) [\(app) | \(window) | x:\(Int(bounds.minX)) y:\(Int(bounds.minY)) w:\(Int(bounds.width)) h:\(Int(bounds.height)) | score:\(score)]"
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func normalize(_ value: String) -> String {
        value
            .lowercased()
            .replacingOccurrences(of: #"[^a-z0-9\s]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
