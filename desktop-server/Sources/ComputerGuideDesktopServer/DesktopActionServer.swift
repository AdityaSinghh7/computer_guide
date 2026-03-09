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
    private let permissionsService = PermissionsService()
    private let applicationService = ApplicationService()
    private let snapshotManager = SnapshotManager()
    private lazy var automationService = UIAutomationService(snapshotManager: snapshotManager)
    private lazy var visionService = DesktopVisionService(snapshotManager: snapshotManager)
    private lazy var detectionService = ElementDetectionService(applicationService: applicationService)
    private lazy var targetResolver = TargetResolver(
        applicationService: applicationService,
        detectionService: detectionService,
        snapshotManager: snapshotManager)
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
                let result = try await self.handleClick(payload, actionID: actionID, startedAt: startedAt)
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
                let result = try await self.handleType(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/drag"):
                let payload: DragRequest = try self.decode(request.body)
                let result = try await self.handleDrag(payload, actionID: actionID, startedAt: startedAt)
                await self.recordSuccess(
                    request: request,
                    actionID: actionID,
                    startedAt: startedAt,
                    responseStatus: 200,
                    result: result)
                return try HTTPResponse.json(result)
            case (.POST, "/v1/scroll"):
                let payload: ScrollRequestPayload = try self.decode(request.body)
                let result = try await self.handleScroll(payload, actionID: actionID, startedAt: startedAt)
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

    private func decode<T: Decodable>(_ body: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: body)
        } catch {
            throw DesktopServerError.invalidInput("Invalid JSON body: \(error.localizedDescription)")
        }
    }

    private func handleClick(_ request: ClickRequest, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        try self.requireAccessibility()
        try await self.activateRequestedApplication(request.app)

        let clickCount = max(1, request.num_clicks ?? 1)
        guard let button = MouseButtonKind(rawValue: (request.button_type ?? "left").lowercased()) else {
            throw DesktopServerError.invalidInput("Unsupported button_type '\(request.button_type ?? "")'")
        }
        let modifiers = request.hold_keys ?? []
        let resolved = try await self.targetResolver.resolve(
            description: request.element_description,
            intent: .click,
            context: TargetContext(
                app: request.app,
                windowTitle: request.window_title,
                snapshotID: request.snapshot_id,
                elementID: request.element_id))
        let point = CGPoint(x: resolved.bounds.midX, y: resolved.bounds.midY)
        let snapshotID = request.snapshot_id?.trimmingCharacters(in: .whitespacesAndNewlines)
        let elementID = request.element_id?.trimmingCharacters(in: .whitespacesAndNewlines)

        if modifiers.isEmpty, button != .middle, clickCount <= 2, let snapshotID, let elementID, !snapshotID.isEmpty, !elementID.isEmpty {
            let clickType: ClickType = clickCount == 2 ? .double : (button == .right ? .right : .single)
            try await self.automationService.click(target: .elementId(elementID), clickType: clickType, snapshotId: snapshotID)
        } else if modifiers.isEmpty, button != .middle, clickCount <= 2 {
            let clickType: ClickType = clickCount == 2 ? .double : (button == .right ? .right : .single)
            try await self.automationService.click(target: .coordinates(point), clickType: clickType, snapshotId: nil)
        } else {
            try self.customInput.performPointerClick(at: point, button: button, clickCount: clickCount, modifiers: modifiers)
        }

        return self.success(
            actionID: actionID,
            message: "Clicked \(resolved.label ?? resolved.elementID)",
            target: resolved,
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
        return self.success(actionID: actionID, message: "Launched \(app.name)", target: nil, startedAt: startedAt)
    }

    private func handleType(_ request: TypeRequest, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        try self.requireAccessibility()
        try await self.activateRequestedApplication(request.app)

        var resolvedTarget: ResolvedElement?
        let hasDescription = !(request.element_description?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        let hasGroundedElement = (request.snapshot_id?.isEmpty == false) && (request.element_id?.isEmpty == false)

        if hasDescription || hasGroundedElement {
            let resolved = try await self.targetResolver.resolve(
                description: request.element_description ?? "",
                intent: .type,
                context: TargetContext(
                    app: request.app,
                    windowTitle: request.window_title,
                    snapshotID: request.snapshot_id,
                    elementID: request.element_id))
            resolvedTarget = resolved
            let snapshotID = request.snapshot_id?.trimmingCharacters(in: .whitespacesAndNewlines)
            let elementID = request.element_id?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let snapshotID, let elementID, !snapshotID.isEmpty, !elementID.isEmpty {
                try await self.automationService.type(
                    text: request.text,
                    target: elementID,
                    clearExisting: request.overwrite ?? false,
                    typingDelay: 50,
                    snapshotId: snapshotID)

                if request.enter ?? false {
                    try self.customInput.performHeldKeySequence(holdKeys: [], pressKeys: ["return"])
                }

                return self.success(
                    actionID: actionID,
                    message: "Typed \(request.text.count) characters",
                    target: resolvedTarget,
                    startedAt: startedAt)
            }

            let point = CGPoint(x: resolved.bounds.midX, y: resolved.bounds.midY)
            try await self.automationService.click(target: .coordinates(point), clickType: .single, snapshotId: nil)
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        if request.overwrite ?? false {
            try await self.automationService.hotkey(keys: "cmd,a", holdDuration: 0)
            try self.customInput.performHeldKeySequence(holdKeys: [], pressKeys: ["delete"])
        }

        try await self.automationService.type(
            text: request.text,
            target: nil,
            clearExisting: false,
            typingDelay: 50,
            snapshotId: nil)

        if request.enter ?? false {
            try self.customInput.performHeldKeySequence(holdKeys: [], pressKeys: ["return"])
        }

        return self.success(
            actionID: actionID,
            message: "Typed \(request.text.count) characters",
            target: resolvedTarget,
            startedAt: startedAt)
    }

    private func handleDrag(_ request: DragRequest, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        try self.requireAccessibility()
        try await self.activateRequestedApplication(request.app)

        let start = try await self.targetResolver.resolve(
            description: request.starting_description,
            intent: .drag,
            context: TargetContext(
                app: request.app,
                windowTitle: request.window_title,
                snapshotID: request.snapshot_id,
                elementID: request.starting_element_id))
        let end = try await self.targetResolver.resolve(
            description: request.ending_description,
            intent: .drag,
            context: TargetContext(
                app: request.app,
                windowTitle: request.window_title,
                snapshotID: request.snapshot_id,
                elementID: request.ending_element_id))

        try await self.automationService.drag(
            from: CGPoint(x: start.bounds.midX, y: start.bounds.midY),
            to: CGPoint(x: end.bounds.midX, y: end.bounds.midY),
            duration: 500,
            steps: 24,
            modifiers: self.modifierString(from: request.hold_keys ?? []),
            profile: .linear)

        return self.success(
            actionID: actionID,
            message: "Dragged from \(start.label ?? start.elementID) to \(end.label ?? end.elementID)",
            target: end,
            startedAt: startedAt)
    }

    private func handleScroll(_ request: ScrollRequestPayload, actionID: String, startedAt: Date) async throws -> SuccessResponse {
        try self.requireAccessibility()
        try await self.activateRequestedApplication(request.app)
        guard request.clicks != 0 else {
            throw DesktopServerError.invalidInput("clicks must not be 0")
        }

        let resolved = try await self.targetResolver.resolve(
            description: request.element_description,
            intent: .scroll,
            context: TargetContext(
                app: request.app,
                windowTitle: request.window_title,
                snapshotID: request.snapshot_id,
                elementID: request.element_id))
        try await self.automationService.moveMouse(
            to: CGPoint(x: resolved.bounds.midX, y: resolved.bounds.midY),
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

        return self.success(
            actionID: actionID,
            message: "Scrolled \(request.element_description)",
            target: resolved,
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
        try await self.activateRequestedApplication(request.app)
        return try await self.visionService.capture(request: request, actionID: actionID, startedAt: startedAt)
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
            duration_ms: Int(Date().timeIntervalSince(startedAt) * 1000))
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

    private func record(event: [String: Any]) async {
        guard JSONSerialization.isValidJSONObject(event) else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        await self.observability.record(serializedEvent: data)
    }
}
