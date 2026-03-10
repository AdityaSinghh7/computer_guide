import AppKit
import CoreGraphics
import Foundation
import ImageIO
import PeekabooAutomationKit

struct GroundingObservabilityContext: Sendable {
    let runID: String?
    let actionID: String
    let method: String
    let path: String
}

struct GroundedPoint: Sendable {
    let description: String
    let screenshotPoint: CGPoint
    let screenPoint: CGPoint
    let captureBounds: CGRect
    let screenshotPath: String?
    let applicationName: String?
    let windowTitle: String?
}

struct GroundingCaptureArtifact: Sendable {
    let screenshotPath: String
    let captureBounds: CGRect
    let applicationName: String?
    let windowTitle: String?
}

struct GroundingModelResult: Sendable {
    let point: CGPoint
    let rawResponse: String
    let model: String
}

protocol GroundingModelClient: Sendable {
    func groundCoordinate(
        imageData: Data,
        imageSize: CGSize,
        elementDescription: String) async throws -> GroundingModelResult
}

struct OpenRouterGroundingModelClient: GroundingModelClient {
    private let session: URLSession
    private let apiKey: String
    private let baseURL: URL
    private let model: String

    init(session: URLSession = .shared) throws {
        let environment = ProcessInfo.processInfo.environment

        guard let apiKey = environment["OPENROUTER_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !apiKey.isEmpty
        else {
            throw DesktopServerError.serverUnavailable("OPENROUTER_API_KEY is not set")
        }

        guard let model = environment["COMPUTER_GUIDE_GROUNDING_MODEL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !model.isEmpty
        else {
            throw DesktopServerError.serverUnavailable("COMPUTER_GUIDE_GROUNDING_MODEL is not set")
        }

        let baseURLString = environment["COMPUTER_GUIDE_GROUNDING_BASE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? "https://openrouter.ai/api/v1"
        guard let baseURL = URL(string: baseURLString) else {
            throw DesktopServerError.serverUnavailable("Invalid COMPUTER_GUIDE_GROUNDING_BASE_URL '\(baseURLString)'")
        }

        self.session = session
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.model = model
    }

    func groundCoordinate(
        imageData: Data,
        imageSize: CGSize,
        elementDescription: String) async throws -> GroundingModelResult
    {
        let dataURL = "data:image/png;base64,\(imageData.base64EncodedString())"
        let prompt = """
        You are a UI grounding model.
        Return only strict JSON with integer fields x and y.
        The coordinates must be in screenshot pixel space with origin at the top-left of the image.
        Choose the center of the described target.
        Image size: \(Int(imageSize.width))x\(Int(imageSize.height)) pixels.
        Target: \(elementDescription)
        """

        let payload: [String: Any] = [
            "model": self.model,
            "temperature": 0,
            "max_tokens": 80,
            "reasoning": [
                "enabled": false,
            ],
            "messages": [
                [
                    "role": "user",
                    "content": [
                        [
                            "type": "text",
                            "text": prompt,
                        ],
                        [
                            "type": "image_url",
                            "image_url": [
                                "url": dataURL,
                            ],
                        ],
                    ],
                ],
            ],
        ]

        guard JSONSerialization.isValidJSONObject(payload) else {
            throw DesktopServerError.serverUnavailable("Failed to encode grounding request")
        }

        var request = URLRequest(url: self.baseURL.appendingPathComponent("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(self.apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DesktopServerError.serverUnavailable("Grounding request did not return an HTTP response")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw DesktopServerError.serverUnavailable(
                "Grounding request failed with HTTP \(httpResponse.statusCode): \(body)")
        }

        let content = try Self.extractContent(from: data)
        return GroundingModelResult(
            point: try Self.parsePoint(from: content),
            rawResponse: content,
            model: self.model)
    }

    private static func extractContent(from data: Data) throws -> String {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]],
              let firstChoice = choices.first,
              let message = firstChoice["message"] as? [String: Any]
        else {
            throw DesktopServerError.serverUnavailable("Grounding response had an unexpected shape")
        }

        if let content = message["content"] as? String {
            return content
        }

        if let blocks = message["content"] as? [[String: Any]] {
            let text = blocks
                .compactMap { block -> String? in
                    guard let type = block["type"] as? String, type == "text" else { return nil }
                    return block["text"] as? String
                }
                .joined(separator: "\n")
            if !text.isEmpty {
                return text
            }
        }

        throw DesktopServerError.serverUnavailable("Grounding response did not contain text output")
    }

    private static func parsePoint(from content: String) throws -> CGPoint {
        if let data = content.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let x = object["x"] as? NSNumber,
           let y = object["y"] as? NSNumber
        {
            return CGPoint(x: x.doubleValue, y: y.doubleValue)
        }

        if let start = content.firstIndex(of: "{"),
           let end = content.lastIndex(of: "}"),
           start <= end
        {
            let jsonSubstring = String(content[start...end])
            if let data = jsonSubstring.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let x = object["x"] as? NSNumber,
               let y = object["y"] as? NSNumber
            {
                return CGPoint(x: x.doubleValue, y: y.doubleValue)
            }
        }

        let regex = try NSRegularExpression(pattern: "-?\\d+(?:\\.\\d+)?")
        let nsRange = NSRange(content.startIndex..<content.endIndex, in: content)
        let numbers = regex
            .matches(in: content, range: nsRange)
            .compactMap { match -> Double? in
                guard let range = Range(match.range, in: content) else { return nil }
                return Double(content[range])
            }
        guard numbers.count >= 2 else {
            throw DesktopServerError.serverUnavailable("Grounding response did not include usable coordinates: \(content)")
        }

        return CGPoint(x: numbers[0], y: numbers[1])
    }
}

@MainActor
final class GroundingService {
    private enum CaptureTarget {
        case frontmost
        case app(String)
    }

    private let screenCaptureService: ScreenCaptureService
    private let permissionsService: PermissionsService
    private let modelClient: GroundingModelClient
    private let observability: LocalObservability?

    init(
        screenCaptureService: ScreenCaptureService,
        permissionsService: PermissionsService = PermissionsService(),
        modelClient: GroundingModelClient? = nil,
        observability: LocalObservability? = nil) throws
    {
        self.screenCaptureService = screenCaptureService
        self.permissionsService = permissionsService
        self.modelClient = try modelClient ?? OpenRouterGroundingModelClient()
        self.observability = observability
    }

    func requestScreenRecordingPermissionIfNeeded() {
        guard !self.permissionsService.checkScreenRecordingPermission() else {
            return
        }
        _ = self.permissionsService.requestScreenRecordingPermission(interactive: true)
    }

    func ground(
        elementDescription: String,
        app: String?,
        observabilityContext: GroundingObservabilityContext? = nil) async throws -> GroundedPoint
    {
        let startedAt = Date()
        let normalizedDescription = elementDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedDescription.isEmpty else {
            throw DesktopServerError.invalidInput("element_description must not be empty")
        }

        guard self.permissionsService.checkScreenRecordingPermission() else {
            throw DesktopServerError.permissionDenied("Screen Recording permission is required")
        }

        var screenshotPath: String?
        var captureBounds: CGRect?
        var imageSize: CGSize?
        var applicationName: String?
        var windowTitle: String?
        var modelResult: GroundingModelResult?

        do {
            let captureResult = try await self.capture(target: Self.captureTarget(for: app))
            captureBounds = captureResult.captureBounds
            imageSize = Self.imagePixelSize(
                from: captureResult.result.imageData,
                fallback: captureResult.result.metadata.size)
            applicationName = captureResult.applicationName
            windowTitle = captureResult.windowTitle
            screenshotPath = try self.saveGroundingScreenshot(
                imageData: captureResult.result.imageData,
                observabilityContext: observabilityContext)
            modelResult = try await self.modelClient.groundCoordinate(
                imageData: captureResult.result.imageData,
                imageSize: imageSize ?? captureResult.result.metadata.size,
                elementDescription: normalizedDescription)
            let screenshotPoint = modelResult?.point ?? .zero
            let screenPoint = Self.mapScreenshotPointToScreen(
                screenshotPoint,
                imageSize: imageSize ?? captureResult.result.metadata.size,
                captureBounds: captureResult.captureBounds)
            let groundedPoint = GroundedPoint(
                description: normalizedDescription,
                screenshotPoint: screenshotPoint,
                screenPoint: screenPoint,
                captureBounds: captureResult.captureBounds,
                screenshotPath: screenshotPath,
                applicationName: applicationName,
                windowTitle: windowTitle)
            await self.recordGroundingSuccess(
                context: observabilityContext,
                startedAt: startedAt,
                elementDescription: normalizedDescription,
                app: app,
                groundedPoint: groundedPoint,
                imageSize: imageSize ?? captureResult.result.metadata.size,
                screenshotPath: screenshotPath,
                modelResult: modelResult!)
            return groundedPoint
        } catch let error as DesktopServerError {
            await self.recordGroundingFailure(
                context: observabilityContext,
                startedAt: startedAt,
                elementDescription: normalizedDescription,
                app: app,
                screenshotPath: screenshotPath,
                captureBounds: captureBounds,
                imageSize: imageSize,
                applicationName: applicationName,
                windowTitle: windowTitle,
                modelResult: modelResult,
                error: error)
            throw error
        } catch {
            let wrappedError = DesktopServerError.serverUnavailable(error.localizedDescription)
            await self.recordGroundingFailure(
                context: observabilityContext,
                startedAt: startedAt,
                elementDescription: normalizedDescription,
                app: app,
                screenshotPath: screenshotPath,
                captureBounds: captureBounds,
                imageSize: imageSize,
                applicationName: applicationName,
                windowTitle: windowTitle,
                modelResult: modelResult,
                error: wrappedError)
            throw wrappedError
        }
    }

    nonisolated static func mapScreenshotPointToScreen(
        _ screenshotPoint: CGPoint,
        imageSize: CGSize,
        captureBounds: CGRect) -> CGPoint
    {
        let width = max(imageSize.width, 1)
        let height = max(imageSize.height, 1)

        let clampedX = min(max(screenshotPoint.x, 0), width - 1)
        let clampedY = min(max(screenshotPoint.y, 0), height - 1)

        let normalizedX = clampedX / width
        let normalizedY = clampedY / height

        var screenX = captureBounds.minX + (normalizedX * captureBounds.width)
        var screenY = captureBounds.minY + (normalizedY * captureBounds.height)

        if clampedX <= 0 {
            screenX = captureBounds.minX
        } else if clampedX >= width - 1 {
            screenX = captureBounds.maxX
        }

        if clampedY <= 0 {
            screenY = captureBounds.minY
        } else if clampedY >= height - 1 {
            screenY = captureBounds.maxY
        }

        return CGPoint(
            x: min(max(screenX, captureBounds.minX), captureBounds.maxX),
            y: min(max(screenY, captureBounds.minY), captureBounds.maxY))
    }

    func captureArtifact(
        app: String?,
        observabilityContext: GroundingObservabilityContext? = nil) async throws -> GroundingCaptureArtifact
    {
        guard self.permissionsService.checkScreenRecordingPermission() else {
            throw DesktopServerError.permissionDenied("Screen Recording permission is required")
        }

        let captureResult = try await self.capture(target: Self.captureTarget(for: app))
        let screenshotPath = try self.saveGroundingScreenshot(
            imageData: captureResult.result.imageData,
            observabilityContext: observabilityContext)
        return GroundingCaptureArtifact(
            screenshotPath: screenshotPath,
            captureBounds: captureResult.captureBounds,
            applicationName: captureResult.applicationName,
            windowTitle: captureResult.windowTitle)
    }

    private struct CapturePayload {
        let result: CaptureResult
        let captureBounds: CGRect
        let applicationName: String?
        let windowTitle: String?
    }

    private func saveGroundingScreenshot(
        imageData: Data,
        observabilityContext: GroundingObservabilityContext?) throws -> String
    {
        let directory = NSString(string: ".logs/desktop-captures").expandingTildeInPath
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let runID = observabilityContext?.runID.flatMap(Self.sanitizedPathComponent) ?? "no-run"
        let actionID = observabilityContext.map { Self.sanitizedPathComponent($0.actionID) } ?? "grounding"
        let filename = "ground-\(runID)-\(actionID)-\(timestamp)-\(UUID().uuidString).png"
        let outputPath = (directory as NSString).appendingPathComponent(filename)

        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        try imageData.write(to: URL(fileURLWithPath: outputPath))
        return outputPath
    }

    private func recordGroundingSuccess(
        context: GroundingObservabilityContext?,
        startedAt: Date,
        elementDescription: String,
        app: String?,
        groundedPoint: GroundedPoint,
        imageSize: CGSize,
        screenshotPath: String?,
        modelResult: GroundingModelResult) async
    {
        var event = self.baseGroundingEvent(context: context, startedAt: startedAt)
        event["outcome"] = "success"
        event["message"] = "Grounded \(elementDescription)"
        event["grounding"] = self.groundingPayload(
            elementDescription: elementDescription,
            app: app,
            applicationName: groundedPoint.applicationName,
            windowTitle: groundedPoint.windowTitle,
            captureBounds: groundedPoint.captureBounds,
            imageSize: imageSize,
            screenshotPath: screenshotPath,
            screenshotPoint: groundedPoint.screenshotPoint,
            screenPoint: groundedPoint.screenPoint,
            modelResult: modelResult)
        await self.record(event: event)
    }

    private func recordGroundingFailure(
        context: GroundingObservabilityContext?,
        startedAt: Date,
        elementDescription: String,
        app: String?,
        screenshotPath: String?,
        captureBounds: CGRect?,
        imageSize: CGSize?,
        applicationName: String?,
        windowTitle: String?,
        modelResult: GroundingModelResult?,
        error: DesktopServerError) async
    {
        var event = self.baseGroundingEvent(context: context, startedAt: startedAt)
        event["outcome"] = "error"
        event["message"] = "Failed to ground \(elementDescription)"
        event["error"] = [
            "code": error.code.rawValue,
            "message": error.message,
            "candidates": error.candidates ?? [],
        ]
        event["grounding"] = self.groundingPayload(
            elementDescription: elementDescription,
            app: app,
            applicationName: applicationName,
            windowTitle: windowTitle,
            captureBounds: captureBounds,
            imageSize: imageSize,
            screenshotPath: screenshotPath,
            screenshotPoint: modelResult?.point,
            screenPoint: nil,
            modelResult: modelResult)
        await self.record(event: event)
    }

    private func baseGroundingEvent(
        context: GroundingObservabilityContext?,
        startedAt: Date) -> [String: Any]
    {
        [
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "component": "desktop-server",
            "event_type": "grounding",
            "run_id": context?.runID ?? NSNull(),
            "action_id": context?.actionID ?? NSNull(),
            "method": context?.method ?? "POST",
            "path": context?.path ?? "/v1/ground",
            "duration_ms": Int(Date().timeIntervalSince(startedAt) * 1000),
        ]
    }

    private func groundingPayload(
        elementDescription: String,
        app: String?,
        applicationName: String?,
        windowTitle: String?,
        captureBounds: CGRect?,
        imageSize: CGSize?,
        screenshotPath: String?,
        screenshotPoint: CGPoint?,
        screenPoint: CGPoint?,
        modelResult: GroundingModelResult?) -> [String: Any]
    {
        var payload: [String: Any] = [
            "element_description": elementDescription,
            "app": app ?? NSNull(),
            "application_name": applicationName ?? NSNull(),
            "window_title": windowTitle ?? NSNull(),
            "screenshot_path": screenshotPath ?? NSNull(),
        ]

        if let captureBounds {
            payload["capture_bounds"] = Self.dictionary(from: captureBounds)
        }
        if let imageSize {
            payload["image_size"] = Self.dictionary(from: imageSize)
        }
        if let screenshotPoint {
            payload["screenshot_point"] = Self.dictionary(from: screenshotPoint)
        }
        if let screenPoint {
            payload["screen_point"] = Self.dictionary(from: screenPoint)
        }
        if let modelResult {
            payload["model"] = modelResult.model
            payload["raw_response"] = modelResult.rawResponse
        }

        return payload
    }

    private func record(event: [String: Any]) async {
        guard let observability = self.observability else { return }
        guard JSONSerialization.isValidJSONObject(event) else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        await observability.record(serializedEvent: data)
    }

    private func capture(target: CaptureTarget) async throws -> CapturePayload {
        let seedCapture: CaptureResult
        switch target {
        case .frontmost:
            seedCapture = try await self.screenCaptureService.captureFrontmost()
        case let .app(app):
            seedCapture = try await self.screenCaptureService.captureWindow(appIdentifier: app, windowIndex: nil)
        }

        let result = try await self.screenCaptureService.captureScreen(
            displayIndex: self.displayIndex(for: seedCapture))
        let captureBounds = result.metadata.windowInfo?.bounds ?? result.metadata.displayInfo?.bounds ?? .zero
        guard captureBounds.width > 0, captureBounds.height > 0 else {
            throw DesktopServerError.serverUnavailable("Grounding capture did not include valid bounds")
        }

        return CapturePayload(
            result: result,
            captureBounds: captureBounds,
            applicationName: seedCapture.metadata.applicationInfo?.name,
            windowTitle: seedCapture.metadata.windowInfo?.title)
    }

    private func displayIndex(for captureResult: CaptureResult) -> Int? {
        let targetBounds = captureResult.metadata.windowInfo?.bounds ?? captureResult.metadata.displayInfo?.bounds

        if let targetBounds,
           let matchedScreen = NSScreen.screens.enumerated().max(by: { lhs, rhs in
               self.intersectionArea(of: lhs.element.frame, with: targetBounds)
                   < self.intersectionArea(of: rhs.element.frame, with: targetBounds)
           }),
           self.intersectionArea(of: matchedScreen.element.frame, with: targetBounds) > 0
        {
            return matchedScreen.offset
        }

        return captureResult.metadata.displayInfo?.index
    }

    private func intersectionArea(of lhs: CGRect, with rhs: CGRect) -> CGFloat {
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, !intersection.isEmpty else {
            return 0
        }

        return intersection.width * intersection.height
    }

    private static func captureTarget(for app: String?) -> CaptureTarget {
        guard let app, !app.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .frontmost
        }
        return .app(app)
    }

    private static func imagePixelSize(from imageData: Data, fallback: CGSize) -> CGSize {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
              width.doubleValue > 0,
              height.doubleValue > 0
        else {
            return fallback
        }

        return CGSize(width: width.doubleValue, height: height.doubleValue)
    }

    private static func dictionary(from point: CGPoint) -> [String: Any] {
        [
            "x": point.x,
            "y": point.y,
        ]
    }

    private static func dictionary(from size: CGSize) -> [String: Any] {
        [
            "width": size.width,
            "height": size.height,
        ]
    }

    private static func dictionary(from rect: CGRect) -> [String: Any] {
        [
            "x": rect.origin.x,
            "y": rect.origin.y,
            "width": rect.size.width,
            "height": rect.size.height,
        ]
    }

    private static func sanitizedPathComponent(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let sanitized = trimmed.replacingOccurrences(
            of: #"[^A-Za-z0-9._-]+"#,
            with: "-",
            options: .regularExpression)
        return sanitized.isEmpty ? "unknown" : sanitized
    }
}
