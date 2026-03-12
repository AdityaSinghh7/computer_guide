import AppKit
import CoreGraphics
import Foundation
import PeekabooAutomationKit
import PeekabooFoundation

@MainActor
final class DesktopActionServer {
    private let host: String
    private let port: Int
    private let token: String
    private let observability: LocalObservability
    private let loggingService = LoggingService()
    private let permissionsService = PermissionsService()
    private let applicationService = ApplicationService()
    private let snapshotManager = SnapshotManager()
    private lazy var automationService = UIAutomationService(snapshotManager: snapshotManager)
    private lazy var visionService = DesktopVisionService(snapshotManager: snapshotManager, loggingService: loggingService)
    private var cachedGroundingService: GroundingService?
    private var cachedGroundedActionPipeline: GroundedActionPipeline?
    private let customInput = CustomInputPerformer()

    init(host: String, port: Int, token: String, observability: LocalObservability) {
        self.host = host
        self.port = port
        self.token = token
        self.observability = observability
    }

    func handle(_ request: HTTPRequest) async -> HTTPResponse {
        let startedAt = Date()
        let actionID = UUID().uuidString

        do {
            try self.authorize(request)

            switch (request.method, request.path) {
            case (.GET, "/v1/health"):
                let payload = HealthPayload(ok: true, host: host, port: port)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    message: "Health check",
                    target: nil,
                    response: [
                        "ok": payload.ok,
                        "host": payload.host,
                        "port": payload.port,
                    ])
                return try HTTPResponse.json(payload)
            case (.GET, "/v1/permissions"):
                let payload = self.permissionsPayload()
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    message: "Permissions check",
                    target: nil,
                    response: [
                        "screen_recording": payload.screen_recording,
                        "accessibility": payload.accessibility,
                        "apple_script": payload.apple_script,
                    ])
                return try HTTPResponse.json(payload)
            case (.POST, "/v1/permissions/request-accessibility"):
                let payload = self.requestAccessibilityPermission()
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    message: payload.message,
                    target: nil,
                    response: [
                        "permission": payload.permission,
                        "granted": payload.granted,
                        "prompt_triggered": payload.prompt_triggered,
                    ])
                return try HTTPResponse.json(payload)
            case (.POST, "/v1/permissions/request-screen-recording"):
                let payload = self.requestScreenRecordingPermission()
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    message: payload.message,
                    target: nil,
                    response: [
                        "permission": payload.permission,
                        "granted": payload.granted,
                        "prompt_triggered": payload.prompt_triggered,
                    ])
                return try HTTPResponse.json(payload)
            case (.POST, "/v1/click"):
                let payload: ClickRequest = try self.decode(request.body)
                let result = try await self.handleClick(payload, httpRequest: request, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/switch-application"):
                let payload: SwitchApplicationRequest = try self.decode(request.body)
                let result = try await self.handleSwitchApplication(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/open"):
                let payload: OpenRequest = try self.decode(request.body)
                let result = try await self.handleOpen(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/type"):
                let payload: TypeRequest = try self.decode(request.body)
                let result = try await self.handleType(payload, httpRequest: request, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/drag"):
                let payload: DragRequest = try self.decode(request.body)
                let result = try await self.handleDrag(payload, httpRequest: request, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/scroll"):
                let payload: ScrollRequestPayload = try self.decode(request.body)
                let result = try await self.handleScroll(payload, httpRequest: request, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/hotkey"):
                let payload: HotkeyRequest = try self.decode(request.body)
                let result = try await self.handleHotkey(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/hold-and-press"):
                let payload: HoldAndPressRequest = try self.decode(request.body)
                let result = try await self.handleHoldAndPress(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/wait"):
                let payload: WaitRequest = try self.decode(request.body)
                let result = try await self.handleWait(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/see"):
                let payload: SeeRequestPayload = try self.decode(request.body)
                let result = try await self.handleSee(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    message: result.message,
                    target: nil,
                    response: [
                        "snapshot_id": result.snapshot_id,
                        "element_count": result.element_count,
                        "interactable_count": result.interactable_count,
                        "capture_mode": result.capture_mode,
                    ])
                return try HTTPResponse.json(result)
            case (.GET, _), (.POST, _):
                let error = DesktopServerError.invalidInput("Unknown route \(request.path)")
                await self.recordFailure(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    error: error)
                return try HTTPResponse.json(
                    ErrorResponse(error: ErrorEnvelope(
                        code: .invalidInput,
                        message: "Unknown route \(request.path)",
                        candidates: nil)),
                    statusCode: 404)
            }
        } catch let error as DesktopServerError {
            await self.recordFailure(
                request: request,
                actionID: actionID,
                startedAt: startedAt,
                error: error)
            return self.errorResponse(error)
        } catch {
            let wrappedError = DesktopServerError.serverUnavailable(error.localizedDescription)
            await self.recordFailure(
                request: request,
                actionID: actionID,
                startedAt: startedAt,
                error: wrappedError)
            return self.errorResponse(wrappedError)
        }
    }

    private func authorize(_ request: HTTPRequest) throws {
        guard request.bearerToken == token else {
            throw DesktopServerError.permissionDenied("Missing or invalid bearer token")
        }
    }

    private func permissionsPayload() -> PermissionStatusPayload {
        let permissions = self.permissionsService.checkAllPermissions()
        return PermissionStatusPayload(
            screen_recording: permissions.screenRecording,
            accessibility: permissions.accessibility,
            apple_script: permissions.appleScript,
            identity: PermissionIdentityPayload(
                display_name: Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Computer Guide Desktop Server",
                bundle_identifier: Bundle.main.bundleIdentifier,
                executable_path: ProcessInfo.processInfo.arguments.first ?? "unknown"))
    }

    private func requestAccessibilityPermission() -> PermissionRequestResultPayload {
        let granted = self.permissionsService.requestAccessibilityPermission(interactive: true)
        return PermissionRequestResultPayload(
            permission: "accessibility",
            granted: granted,
            prompt_triggered: true,
            message: granted
                ? "Accessibility permission granted"
                : "Accessibility permission is still required. Enable the desktop server in System Settings > Privacy & Security > Accessibility.")
    }

    private func requestScreenRecordingPermission() -> PermissionRequestResultPayload {
        let granted = self.permissionsService.requestScreenRecordingPermission(interactive: true)
        return PermissionRequestResultPayload(
            permission: "screen_recording",
            granted: granted,
            prompt_triggered: true,
            message: granted
                ? "Screen Recording permission granted"
                : "Screen Recording permission is still required. Enable the desktop server in System Settings > Privacy & Security > Screen Recording.")
    }

    private func requireAccessibility() throws {
        guard permissionsService.checkAccessibilityPermission() else {
            throw DesktopServerError.permissionDenied("Accessibility permission is required")
        }
    }

    private func requireGroundingPermissions() throws {
        try self.requireAccessibility()
        if !self.permissionsService.checkScreenRecordingPermission() {
            _ = self.permissionsService.requestScreenRecordingPermission(interactive: true)
        }
        guard permissionsService.checkScreenRecordingPermission() else {
            throw DesktopServerError.permissionDenied("Screen Recording permission is required")
        }
    }

    private func groundingClient() throws -> GroundingService {
        if let cachedGroundingService = self.cachedGroundingService {
            return cachedGroundingService
        }
        let groundingService = try GroundingService(
            screenCaptureService: ScreenCaptureService(loggingService: loggingService),
            permissionsService: permissionsService,
            observability: observability)
        self.cachedGroundingService = groundingService
        return groundingService
    }

    private func decode<T: Decodable>(_ body: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: body)
        } catch {
            throw DesktopServerError.invalidInput("Invalid JSON body: \(error.localizedDescription)")
        }
    }

    private func groundedActionPipeline() throws -> GroundedActionPipeline {
        if let cachedGroundedActionPipeline = self.cachedGroundedActionPipeline {
            return cachedGroundedActionPipeline
        }
        let pipeline = GroundedActionPipeline(groundingService: try self.groundingClient())
        self.cachedGroundedActionPipeline = pipeline
        return pipeline
    }

    private func handleClick(
        _ request: ClickRequest,
        httpRequest: HTTPRequest,
        actionID: String,
        startedAt: Date) async throws -> SuccessResponse
    {
        try self.requireGroundingPermissions()
        try await self.activateRequestedApplication(request.app)

        let clickCount = max(1, request.num_clicks ?? 1)
        guard let button = MouseButtonKind(rawValue: (request.button_type ?? "left").lowercased()) else {
            throw DesktopServerError.invalidInput("Unsupported button_type '\(request.button_type ?? "")'")
        }
        let modifiers = request.hold_keys ?? []
        let artifact = try await self.groundedActionPipeline().executeSingle(
            description: request.element_description,
            app: request.app,
            observationCapture: request.observation_capture,
            observabilityContext: self.groundingObservabilityContext(for: httpRequest, actionID: actionID)) { grounded in
                try self.customInput.performPointerClick(
                    at: grounded.screenPoint,
                    button: button,
                    clickCount: clickCount,
                    modifiers: modifiers)
            }

        return self.success(
            actionID: actionID,
            message: "Clicked \(request.element_description)",
            target: artifact.targets.first.map { self.makeGroundedResolvedElement(from: $0.point) },
            artifact: self.makeActionArtifactPayload(from: artifact),
            startedAt: startedAt)
    }

    private func handleSwitchApplication(
        _ request: SwitchApplicationRequest,
        actionID: String,
        startedAt: Date) async throws -> SuccessResponse
    {
        try self.requireAccessibility()
        let target = request.app_code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else {
            throw DesktopServerError.invalidInput("app_code cannot be empty")
        }
        guard await self.applicationService.isApplicationRunning(identifier: target) else {
            throw DesktopServerError.targetNotFound("Application '\(target)' is not running")
        }
        try await self.applicationService.activateApplication(identifier: target)
        return self.success(actionID: actionID, message: "Switched to \(target)", target: nil, startedAt: startedAt)
    }

    private func handleOpen(_ request: OpenRequest, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        let target = request.app_or_filename?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let urlString = request.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let application = request.application?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let ensureWindow = request.ensure_window ?? false

        guard !target.isEmpty || !urlString.isEmpty else {
            throw DesktopServerError.invalidInput("open requires app_or_filename or url")
        }

        if !urlString.isEmpty {
            guard let url = URL(string: urlString), url.scheme != nil else {
                throw DesktopServerError.invalidInput("Invalid url '\(urlString)'")
            }

            if !application.isEmpty {
                let applicationURL = try self.resolveApplicationURL(application)
                let configuration = NSWorkspace.OpenConfiguration()
                let opened = try await self.open(urls: [url], withApplicationAt: applicationURL, configuration: configuration)
                guard opened else {
                    throw DesktopServerError.serverUnavailable("Failed to open URL '\(urlString)' with '\(application)'")
                }
                return self.success(
                    actionID: actionID,
                    message: "Opened \(urlString) in \(application)",
                    target: nil,
                    startedAt: startedAt)
            }

            guard NSWorkspace.shared.open(url) else {
                throw DesktopServerError.serverUnavailable("Failed to open URL '\(urlString)'")
            }
            return self.success(actionID: actionID, message: "Opened \(urlString)", target: nil, startedAt: startedAt)
        }

        let expandedPath = NSString(string: target).expandingTildeInPath
        if FileManager.default.fileExists(atPath: expandedPath) {
            guard NSWorkspace.shared.open(URL(fileURLWithPath: expandedPath)) else {
                throw DesktopServerError.serverUnavailable("Failed to open path '\(target)'")
            }
            return self.success(actionID: actionID, message: "Opened \(target)", target: nil, startedAt: startedAt)
        }

        let app = try await self.applicationService.launchApplication(identifier: target)
        if ensureWindow {
            try self.requireAccessibility()
            try await self.applicationService.activateApplication(identifier: app.bundleIdentifier ?? app.name)

            // Many desktop apps surface a primary window with Cmd+N after launch/activation.
            try await Task.sleep(nanoseconds: 500_000_000)
            do {
                try await self.automationService.hotkey(keys: "cmd,n", holdDuration: 0)
                try await Task.sleep(nanoseconds: 500_000_000)
            } catch {
                // Some apps do not support creating a new window this way. The caller will decide how to recover.
            }
        }

        let message = ensureWindow ? "Launched \(app.name) and attempted to surface a window" : "Launched \(app.name)"
        return self.success(actionID: actionID, message: message, target: nil, startedAt: startedAt)
    }

    private func handleType(
        _ request: TypeRequest,
        httpRequest: HTTPRequest,
        actionID: String,
        startedAt: Date) async throws -> SuccessResponse
    {
        try self.requireGroundingPermissions()
        try await self.activateRequestedApplication(request.app)

        let artifact = try await self.groundedActionPipeline().executeSingle(
            description: request.element_description,
            app: request.app,
            observationCapture: request.observation_capture,
            observabilityContext: self.groundingObservabilityContext(for: httpRequest, actionID: actionID)) { grounded in
                try self.customInput.performPointerClick(at: grounded.screenPoint, button: .left, clickCount: 1, modifiers: [])
                try await Task.sleep(nanoseconds: 100_000_000)

                if request.overwrite {
                    try await self.automationService.hotkey(keys: "cmd,a", holdDuration: 0)
                    try self.customInput.performHeldKeySequence(holdKeys: [], pressKeys: ["delete"])
                }

                try await self.automationService.type(
                    text: request.text,
                    target: nil,
                    clearExisting: false,
                    typingDelay: 50,
                    snapshotId: nil)

                if request.enter {
                    try self.customInput.performHeldKeySequence(holdKeys: [], pressKeys: ["return"])
                }
            }

        return self.success(
            actionID: actionID,
            message: "Typed \(request.text.count) characters",
            target: artifact.targets.first.map { self.makeGroundedResolvedElement(from: $0.point) },
            artifact: self.makeActionArtifactPayload(from: artifact),
            startedAt: startedAt)
    }

    private func handleDrag(
        _ request: DragRequest,
        httpRequest: HTTPRequest,
        actionID: String,
        startedAt: Date) async throws -> SuccessResponse
    {
        try self.requireGroundingPermissions()
        try await self.activateRequestedApplication(request.app)

        let artifact = try await self.groundedActionPipeline().executeDual(
            firstDescription: request.starting_description,
            secondDescription: request.ending_description,
            app: request.app,
            observationCapture: request.observation_capture,
            observabilityContext: self.groundingObservabilityContext(for: httpRequest, actionID: actionID)) { start, end in
                try await self.automationService.drag(
                    from: start.screenPoint,
                    to: end.screenPoint,
                    duration: 500,
                    steps: 24,
                    modifiers: self.modifierString(from: request.hold_keys ?? []),
                    profile: .linear)
            }

        return self.success(
            actionID: actionID,
            message: "Dragged from \(request.starting_description) to \(request.ending_description)",
            target: artifact.targets.last.map { self.makeGroundedResolvedElement(from: $0.point) },
            artifact: self.makeActionArtifactPayload(from: artifact),
            startedAt: startedAt)
    }

    private func handleScroll(
        _ request: ScrollRequestPayload,
        httpRequest: HTTPRequest,
        actionID: String,
        startedAt: Date) async throws -> SuccessResponse
    {
        try self.requireGroundingPermissions()
        try await self.activateRequestedApplication(request.app)
        guard request.clicks != 0 else {
            throw DesktopServerError.invalidInput("clicks must not be 0")
        }

        let artifact = try await self.groundedActionPipeline().executeSingle(
            description: request.element_description,
            app: request.app,
            observationCapture: request.observation_capture,
            observabilityContext: self.groundingObservabilityContext(for: httpRequest, actionID: actionID)) { grounded in
                try await self.automationService.moveMouse(
                    to: grounded.screenPoint,
                    duration: 0,
                    steps: 1,
                    profile: .linear)

                let direction: PeekabooFoundation.ScrollDirection
                if request.shift ?? false {
                    direction = request.clicks > 0 ? .right : .left
                } else {
                    direction = request.clicks > 0 ? .up : .down
                }

                let scrollRequest = PeekabooAutomationKit.ScrollRequest(
                    direction: direction,
                    amount: abs(request.clicks),
                    target: nil,
                    smooth: false,
                    delay: 10,
                    snapshotId: nil)
                try await self.automationService.scroll(scrollRequest)
            }

        return self.success(
            actionID: actionID,
            message: "Scrolled \(request.element_description)",
            target: artifact.targets.first.map { self.makeGroundedResolvedElement(from: $0.point) },
            artifact: self.makeActionArtifactPayload(from: artifact),
            startedAt: startedAt)
    }

    private func handleHotkey(_ request: HotkeyRequest, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        try self.requireAccessibility()
        guard !request.keys.isEmpty else {
            throw DesktopServerError.invalidInput("keys must not be empty")
        }
        try await self.automationService.hotkey(keys: request.keys.joined(separator: ","), holdDuration: 0)
        return self.success(actionID: actionID, message: "Pressed hotkey", target: nil, startedAt: startedAt)
    }

    private func handleHoldAndPress(
        _ request: HoldAndPressRequest,
        actionID: String,
        startedAt: Date) async throws -> SuccessResponse
    {
        try self.requireAccessibility()
        guard !request.hold_keys.isEmpty, !request.press_keys.isEmpty else {
            throw DesktopServerError.invalidInput("hold_keys and press_keys must not be empty")
        }
        try self.customInput.performHeldKeySequence(holdKeys: request.hold_keys, pressKeys: request.press_keys)
        return self.success(actionID: actionID, message: "Pressed key sequence", target: nil, startedAt: startedAt)
    }

    private func handleWait(_ request: WaitRequest, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        guard request.time >= 0 else {
            throw DesktopServerError.invalidInput("time must be >= 0")
        }
        try await Task.sleep(nanoseconds: UInt64(request.time * 1_000_000_000))
        return self.success(actionID: actionID, message: "Waited \(request.time)s", target: nil, startedAt: startedAt)
    }

    private func handleSee(_ request: SeeRequestPayload, actionID: String, startedAt: Date) async throws -> SeeResponse {
        if Self.shouldActivateRequestedApplication(for: request) {
            try await self.activateRequestedApplication(request.app)
        }
        return try await self.visionService.capture(request: request, actionID: actionID, startedAt: startedAt)
    }

    nonisolated static func shouldActivateRequestedApplication(for request: SeeRequestPayload) -> Bool {
        let mode = request.mode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return mode != "screen"
    }

    private func activateRequestedApplication(_ app: String?) async throws {
        guard let app = app?.trimmingCharacters(in: .whitespacesAndNewlines), !app.isEmpty else {
            return
        }
        guard await self.applicationService.isApplicationRunning(identifier: app) else {
            throw DesktopServerError.targetNotFound("Application '\(app)' is not running")
        }
        try await self.applicationService.activateApplication(identifier: app)
    }

    private func resolveApplicationURL(_ target: String) throws -> URL {
        if target.contains("."), let bundleURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: target) {
            return bundleURL
        }

        if FileManager.default.fileExists(atPath: target) {
            return URL(fileURLWithPath: target)
        }

        if let fullPath = NSWorkspace.shared.fullPath(forApplication: target) {
            return URL(fileURLWithPath: fullPath)
        }

        throw DesktopServerError.targetNotFound("Application '\(target)' could not be resolved")
    }

    private func open(
        urls: [URL],
        withApplicationAt applicationURL: URL,
        configuration: NSWorkspace.OpenConfiguration) async throws -> Bool
    {
        try await withCheckedThrowingContinuation { continuation in
            NSWorkspace.shared.open(urls, withApplicationAt: applicationURL, configuration: configuration) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: true)
                }
            }
        }
    }

    private func success(
        actionID: String,
        message: String,
        target: ResolvedElement?,
        artifact: ActionArtifactPayload? = nil,
        startedAt: Date) -> SuccessResponse
    {
        SuccessResponse(
            action_id: actionID,
            ok: true,
            message: message,
            resolved_target: target.map {
                ResolvedTargetPayload(
                    description: $0.label ?? $0.elementID,
                    application: $0.appName,
                    window: $0.windowTitle,
                    bounds: BoundsPayload(rect: $0.bounds))
            },
            artifact: artifact,
            duration_ms: Int(Date().timeIntervalSince(startedAt) * 1000))
    }

    private func makeActionArtifactPayload(from artifact: GroundedActionExecutionArtifact) -> ActionArtifactPayload {
        ActionArtifactPayload(
            before: artifact.before.map {
                ActionCapturePayload(
                    screenshot_path: $0.screenshotPath,
                    application: $0.applicationName,
                    window: $0.windowTitle,
                    capture_bounds: BoundsPayload(rect: $0.captureBounds))
            },
            after: artifact.after.map {
                ActionCapturePayload(
                    screenshot_path: $0.screenshotPath,
                    application: $0.applicationName,
                    window: $0.windowTitle,
                    capture_bounds: BoundsPayload(rect: $0.captureBounds))
            },
            groundings: artifact.targets.map {
                ActionGroundingPayload(
                    description: $0.point.description,
                    screenshot_x: $0.point.screenshotPoint.x,
                    screenshot_y: $0.point.screenshotPoint.y,
                    screen_x: $0.point.screenPoint.x,
                    screen_y: $0.point.screenPoint.y,
                    screenshot_path: $0.point.screenshotPath,
                    application: $0.point.applicationName,
                    window: $0.point.windowTitle,
                    capture_bounds: BoundsPayload(rect: $0.point.captureBounds))
            })
    }

    private func errorResponse(_ error: DesktopServerError) -> HTTPResponse {
        let response = ErrorResponse(error: ErrorEnvelope(code: error.code, message: error.message, candidates: error.candidates))
        return (try? HTTPResponse.json(response, statusCode: error.statusCode)) ?? HTTPResponse(
            statusCode: 500,
            headers: ["content-type": "application/json; charset=utf-8"],
            body: Data("{\"error\":{\"code\":\"SERVER_UNAVAILABLE\",\"message\":\"Failed to encode error\"}}".utf8))
    }

    private func modifierString(from modifiers: [String]) -> String? {
        let value = modifiers
            .map { $0.lowercased() }
            .joined(separator: ",")
        return value.isEmpty ? nil : value
    }

    private func groundingObservabilityContext(
        for request: HTTPRequest,
        actionID: String) -> GroundingObservabilityContext
    {
        GroundingObservabilityContext(
            runID: request.observabilityRunID,
            actionID: actionID,
            method: request.method.rawValue,
            path: request.path)
    }

    private func makeGroundedResolvedElement(from grounded: GroundedPoint) -> ResolvedElement {
        let point = grounded.screenPoint
        let bounds = CGRect(x: point.x - 1, y: point.y - 1, width: 2, height: 2)
        return ResolvedElement(
            appName: grounded.applicationName,
            windowTitle: grounded.windowTitle,
            elementID: "grounded:\(Int(point.x)):\(Int(point.y))",
            elementType: "vision_grounded",
            label: grounded.description,
            bounds: bounds)
    }

    private func recordSuccess(
        request: HTTPRequest,
        actionID: String,
        startedAt: Date,
        responseStatus: Int,
        result: SuccessResponse) async
    {
        await self.recordSuccess(
            request: request,
            actionID: actionID,
            startedAt: startedAt,
            responseStatus: responseStatus,
            message: result.message,
            target: result.resolved_target,
            artifact: result.artifact,
            response: [
                "ok": result.ok,
                "action_id": result.action_id,
                "duration_ms": result.duration_ms,
            ])
    }

    private func recordSuccess(
        request: HTTPRequest,
        actionID: String,
        startedAt: Date,
        responseStatus: Int,
        message: String,
        target: ResolvedTargetPayload?,
        artifact: ActionArtifactPayload? = nil,
        response: [String: Any]) async
    {
        var event = self.baseEvent(request: request, actionID: actionID, startedAt: startedAt)
        event["outcome"] = "success"
        event["status_code"] = responseStatus
        event["message"] = message
        event["response"] = response
        if let target {
            event["resolved_target"] = self.dictionary(from: target)
        }
        if let artifact {
            event["artifact"] = self.dictionary(from: artifact)
        }
        await self.record(event: event)
    }

    private func recordFailure(
        request: HTTPRequest,
        actionID: String,
        startedAt: Date,
        error: DesktopServerError) async
    {
        var event = self.baseEvent(request: request, actionID: actionID, startedAt: startedAt)
        event["outcome"] = "error"
        event["status_code"] = error.statusCode
        event["error"] = [
            "code": error.code.rawValue,
            "message": error.message,
            "candidates": error.candidates ?? [],
        ]
        await self.record(event: event)
    }

    private func baseEvent(request: HTTPRequest, actionID: String, startedAt: Date) -> [String: Any] {
        var event: [String: Any] = [
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "component": "desktop-server",
            "run_id": request.observabilityRunID ?? NSNull(),
            "action_id": actionID,
            "method": request.method.rawValue,
            "path": request.path,
            "duration_ms": Int(Date().timeIntervalSince(startedAt) * 1000),
        ]

        if let payload = self.requestBodyJSON(request.body) {
            event["payload"] = payload
        }

        return event
    }

    private func requestBodyJSON(_ data: Data) -> Any? {
        guard !data.isEmpty else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func dictionary(from target: ResolvedTargetPayload) -> [String: Any] {
        var result: [String: Any] = [
            "description": target.description,
        ]

        if let application = target.application {
            result["application"] = application
        }

        if let window = target.window {
            result["window"] = window
        }

        if let bounds = target.bounds {
            result["bounds"] = [
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.width,
                "height": bounds.height,
            ]
        }

        return result
    }

    private func dictionary(from artifact: ActionArtifactPayload) -> [String: Any] {
        var result: [String: Any] = [
            "groundings": artifact.groundings.map(self.dictionary(from:)),
        ]
        if let before = artifact.before {
            result["before"] = self.dictionary(from: before)
        }
        if let after = artifact.after {
            result["after"] = self.dictionary(from: after)
        }
        return result
    }

    private func dictionary(from capture: ActionCapturePayload) -> [String: Any] {
        var result: [String: Any] = [
            "screenshot_path": capture.screenshot_path,
        ]
        if let application = capture.application {
            result["application"] = application
        }
        if let window = capture.window {
            result["window"] = window
        }
        if let captureBounds = capture.capture_bounds {
            result["capture_bounds"] = [
                "x": captureBounds.x,
                "y": captureBounds.y,
                "width": captureBounds.width,
                "height": captureBounds.height,
            ]
        }
        return result
    }

    private func dictionary(from grounding: ActionGroundingPayload) -> [String: Any] {
        var result: [String: Any] = [
            "description": grounding.description,
            "screenshot_x": grounding.screenshot_x,
            "screenshot_y": grounding.screenshot_y,
            "screen_x": grounding.screen_x,
            "screen_y": grounding.screen_y,
        ]
        if let screenshotPath = grounding.screenshot_path {
            result["screenshot_path"] = screenshotPath
        }
        if let application = grounding.application {
            result["application"] = application
        }
        if let window = grounding.window {
            result["window"] = window
        }
        if let captureBounds = grounding.capture_bounds {
            result["capture_bounds"] = [
                "x": captureBounds.x,
                "y": captureBounds.y,
                "width": captureBounds.width,
                "height": captureBounds.height,
            ]
        }
        return result
    }

    private func record(event: [String: Any]) async {
        guard JSONSerialization.isValidJSONObject(event) else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        await self.observability.record(serializedEvent: data)
    }
}
