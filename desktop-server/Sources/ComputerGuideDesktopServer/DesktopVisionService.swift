import AppKit
import CoreGraphics
import Foundation
import PeekabooAutomationKit
import PeekabooFoundation

@MainActor
final class DesktopVisionService {
    private enum CaptureTarget {
        case frontmost
        case screen(index: Int?)
        case window(app: String, title: String?)
    }

    private struct CaptureContext {
        let result: CaptureResult
        let windowContext: WindowContext?
        let mode: String
    }

    private struct AnnotatedScreenshotRenderer {
        func render(originalPath: String, elements: [DetectedElement]) throws -> String {
            guard let originalImage = NSImage(contentsOfFile: originalPath) else {
                throw DesktopServerError.serverUnavailable("Failed to load screenshot for annotation")
            }

            let annotatedImage = NSImage(size: originalImage.size)
            annotatedImage.lockFocus()
            defer { annotatedImage.unlockFocus() }

            originalImage.draw(
                at: .zero,
                from: NSRect(origin: .zero, size: originalImage.size),
                operation: .copy,
                fraction: 1.0)

            let screenHeight = NSScreen.main?.frame.height ?? originalImage.size.height
            for element in elements where element.isEnabled && element.bounds.width > 0 && element.bounds.height > 0 {
                let rect = NSRect(
                    x: element.bounds.minX,
                    y: screenHeight - element.bounds.minY - element.bounds.height,
                    width: element.bounds.width,
                    height: element.bounds.height)

                NSColor(red: 0.2, green: 0.6, blue: 1.0, alpha: 0.15).setFill()
                NSBezierPath(rect: rect).fill()

                NSColor(red: 0.2, green: 0.6, blue: 1.0, alpha: 0.9).setStroke()
                let border = NSBezierPath(rect: rect)
                border.lineWidth = 2.0
                border.stroke()

                let labelRect = NSRect(x: rect.minX, y: rect.maxY + 4, width: 54, height: 18)
                NSColor(calibratedWhite: 0.1, alpha: 0.85).setFill()
                NSBezierPath(roundedRect: labelRect, xRadius: 4, yRadius: 4).fill()

                let attributes: [NSAttributedString.Key: Any] = [
                    .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .medium),
                    .foregroundColor: NSColor.white,
                ]
                (element.id as NSString).draw(
                    in: NSRect(x: labelRect.minX + 4, y: labelRect.minY + 2, width: labelRect.width - 8, height: labelRect.height - 4),
                    withAttributes: attributes)
            }

            let annotatedPath = originalPath.replacingOccurrences(of: ".png", with: "_annotated.png")
            guard let tiffData = annotatedImage.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiffData),
                  let pngData = bitmap.representation(using: .png, properties: [:])
            else {
                throw DesktopServerError.serverUnavailable("Failed to encode annotated screenshot")
            }

            try pngData.write(to: URL(fileURLWithPath: annotatedPath))
            return annotatedPath
        }
    }

    private let loggingService: LoggingService
    private let snapshotManager: SnapshotManager
    private lazy var automationService = UIAutomationService(
        snapshotManager: snapshotManager,
        loggingService: loggingService)
    private lazy var screenCaptureService = ScreenCaptureService(loggingService: loggingService)
    private let windowService = WindowManagementService()
    private let permissionsService = PermissionsService()

    init(
        snapshotManager: SnapshotManager = SnapshotManager(),
        loggingService: LoggingService = LoggingService())
    {
        self.snapshotManager = snapshotManager
        self.loggingService = loggingService
    }

    func capture(request: SeeRequestPayload, actionID: String, startedAt: Date) async throws -> SeeResponse {
        guard self.permissionsService.checkScreenRecordingPermission() else {
            throw DesktopServerError.permissionDenied("Screen Recording permission is required")
        }

        let target = try self.parseTarget(request)
        let snapshotID = try await self.snapshotManager.createSnapshot()
        let captureContext = try await self.captureContext(for: target)
        let screenshotPath = try self.saveScreenshot(
            imageData: captureContext.result.imageData,
            requestedPath: request.path)

        try await self.snapshotManager.storeScreenshot(
            snapshotId: snapshotID,
            screenshotPath: screenshotPath,
            applicationBundleId: captureContext.result.metadata.applicationInfo?.bundleIdentifier,
            applicationProcessId: captureContext.result.metadata.applicationInfo.map { Int32($0.processIdentifier) },
            applicationName: captureContext.result.metadata.applicationInfo?.name,
            windowTitle: captureContext.result.metadata.windowInfo?.title,
            windowBounds: captureContext.result.metadata.windowInfo?.bounds)

        let detectionResult = try await self.automationService.detectElements(
            in: captureContext.result.imageData,
            snapshotId: snapshotID,
            windowContext: captureContext.windowContext)

        let resultWithPath = ElementDetectionResult(
            snapshotId: detectionResult.snapshotId,
            screenshotPath: screenshotPath,
            elements: detectionResult.elements,
            metadata: detectionResult.metadata)
        try await self.snapshotManager.storeDetectionResult(snapshotId: snapshotID, result: resultWithPath)

        let enabledElements = detectionResult.elements.all.filter(\.isEnabled)
        let annotatedPath: String
        if request.annotate ?? false {
            annotatedPath = try AnnotatedScreenshotRenderer().render(
                originalPath: screenshotPath,
                elements: detectionResult.elements.all)
            try await self.snapshotManager.storeAnnotatedScreenshot(snapshotId: snapshotID, annotatedScreenshotPath: annotatedPath)
        } else {
            annotatedPath = screenshotPath
        }

        let applicationName = captureContext.result.metadata.applicationInfo?.name
        let windowTitle = captureContext.result.metadata.windowInfo?.title

        return SeeResponse(
            action_id: actionID,
            ok: true,
            message: "Captured UI state for \(applicationName ?? "frontmost UI")",
            duration_ms: Int(Date().timeIntervalSince(startedAt) * 1000),
            snapshot_id: snapshotID,
            screenshot_raw: screenshotPath,
            screenshot_annotated: annotatedPath,
            ui_map: self.snapshotManager.getSnapshotStoragePath() + "/\(snapshotID)/snapshot.json",
            application_name: applicationName,
            window_title: windowTitle,
            is_dialog: detectionResult.metadata.isDialog,
            element_count: detectionResult.metadata.elementCount,
            interactable_count: enabledElements.count,
            capture_mode: captureContext.mode,
            execution_time: Date().timeIntervalSince(startedAt),
            ui_elements: detectionResult.elements.all.map(self.makeElementPayload))
    }

    private func parseTarget(_ request: SeeRequestPayload) throws -> CaptureTarget {
        let explicitMode = request.mode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if explicitMode == "screen" {
            return .screen(index: nil)
        }
        if explicitMode == "frontmost" {
            return .frontmost
        }
        if explicitMode == "window" {
            let app = request.app?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !app.isEmpty else {
                throw DesktopServerError.invalidInput("see mode 'window' requires app")
            }
            return .window(app: app, title: request.window_title)
        }

        if let app = request.app?.trimmingCharacters(in: .whitespacesAndNewlines), !app.isEmpty {
            return .window(app: app, title: request.window_title)
        }

        return .frontmost
    }

    private func captureContext(for target: CaptureTarget) async throws -> CaptureContext {
        switch target {
        case .frontmost:
            let result = try await self.screenCaptureService.captureFrontmost()
            let context = WindowContext(
                applicationName: result.metadata.applicationInfo?.name,
                applicationBundleId: result.metadata.applicationInfo?.bundleIdentifier,
                applicationProcessId: result.metadata.applicationInfo.map { Int32($0.processIdentifier) },
                windowTitle: result.metadata.windowInfo?.title,
                windowID: result.metadata.windowInfo?.windowID,
                windowBounds: result.metadata.windowInfo?.bounds,
                shouldFocusWebContent: true)
            return CaptureContext(result: result, windowContext: context, mode: "frontmost")

        case let .screen(index):
            let result = try await self.screenCaptureService.captureScreen(displayIndex: index)
            return CaptureContext(result: result, windowContext: nil, mode: "screen")

        case let .window(app, title):
            let windowID = try await self.resolveWindowID(app: app, title: title)
            let result = if let windowID {
                try await self.screenCaptureService.captureWindow(windowID: CGWindowID(windowID))
            } else {
                try await self.screenCaptureService.captureWindow(appIdentifier: app, windowIndex: nil)
            }
            let context = WindowContext(
                applicationName: result.metadata.applicationInfo?.name ?? app,
                applicationBundleId: result.metadata.applicationInfo?.bundleIdentifier,
                applicationProcessId: result.metadata.applicationInfo.map { Int32($0.processIdentifier) },
                windowTitle: result.metadata.windowInfo?.title ?? title,
                windowID: result.metadata.windowInfo?.windowID ?? windowID,
                windowBounds: result.metadata.windowInfo?.bounds,
                shouldFocusWebContent: true)
            return CaptureContext(result: result, windowContext: context, mode: "window")
        }
    }

    private func resolveWindowID(app: String, title: String?) async throws -> Int? {
        guard let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }

        let windows = try await self.windowService.listWindows(
            target: .applicationAndTitle(app: app, title: title))
        return windows.first?.windowID
    }

    private func saveScreenshot(imageData: Data, requestedPath: String?) throws -> String {
        let outputPath: String
        if let requestedPath, !requestedPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            outputPath = NSString(string: requestedPath).expandingTildeInPath
        } else {
            let timestamp = Int(Date().timeIntervalSince1970 * 1000)
            let directory = NSString(string: ".logs/desktop-captures").expandingTildeInPath
            outputPath = (directory as NSString).appendingPathComponent("see-\(timestamp).png")
        }

        let directory = (outputPath as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true)
        try imageData.write(to: URL(fileURLWithPath: outputPath))
        return outputPath
    }

    private func makeElementPayload(_ element: DetectedElement) -> SeeElementPayload {
        SeeElementPayload(
            id: element.id,
            role: element.type.rawValue,
            title: element.attributes["title"],
            label: element.label,
            description: element.attributes["description"],
            role_description: element.attributes["roleDescription"],
            help: element.attributes["help"],
            identifier: element.attributes["identifier"],
            is_actionable: element.isEnabled,
            keyboard_shortcut: element.attributes["keyboardShortcut"])
    }
}
