import CoreGraphics
import Foundation

enum DesktopServerErrorCode: String, Codable, Sendable {
    case targetNotFound = "TARGET_NOT_FOUND"
    case targetAmbiguous = "TARGET_AMBIGUOUS"
    case permissionDenied = "PERMISSION_DENIED"
    case invalidInput = "INVALID_INPUT"
    case serverUnavailable = "SERVER_UNAVAILABLE"
}

struct ErrorEnvelope: Codable, Sendable {
    let code: DesktopServerErrorCode
    let message: String
    let candidates: [String]?
}

struct SuccessResponse: Codable, Sendable {
    let action_id: String
    let ok: Bool
    let message: String
    let resolved_target: ResolvedTargetPayload?
    let artifact: ActionArtifactPayload?
    let duration_ms: Int
}

struct ErrorResponse: Codable, Sendable {
    let error: ErrorEnvelope
}

struct BoundsPayload: Codable, Sendable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(rect: CGRect) {
        self.x = rect.origin.x
        self.y = rect.origin.y
        self.width = rect.size.width
        self.height = rect.size.height
    }

    var rect: CGRect {
        CGRect(x: self.x, y: self.y, width: self.width, height: self.height)
    }
}

struct SizePayload: Codable, Sendable {
    let width: Double
    let height: Double

    init(size: CGSize) {
        self.width = size.width
        self.height = size.height
    }

    var size: CGSize {
        CGSize(width: self.width, height: self.height)
    }
}

struct ObservationCapturePayload: Codable, Sendable {
    let screenshot_path: String
    let capture_mode: String?
    let display_id: UInt32?
    let display_index: Int?
    let capture_bounds: BoundsPayload
    let image_size: SizePayload
    let application: String?
    let window: String?
}

struct ResolvedTargetPayload: Codable, Sendable {
    let description: String
    let application: String?
    let window: String?
    let bounds: BoundsPayload?
}

struct ActionCapturePayload: Codable, Sendable {
    let screenshot_path: String
    let application: String?
    let window: String?
    let capture_bounds: BoundsPayload?
}

struct ActionGroundingPayload: Codable, Sendable {
    let description: String
    let screenshot_x: Double
    let screenshot_y: Double
    let screen_x: Double
    let screen_y: Double
    let screenshot_path: String?
    let application: String?
    let window: String?
    let capture_bounds: BoundsPayload?
}

struct ActionArtifactPayload: Codable, Sendable {
    let before: ActionCapturePayload?
    let after: ActionCapturePayload?
    let groundings: [ActionGroundingPayload]
}

struct PermissionStatusPayload: Codable, Sendable {
    let screen_recording: Bool
    let accessibility: Bool
    let apple_script: Bool
    let identity: PermissionIdentityPayload
}

struct PermissionIdentityPayload: Codable, Sendable {
    let display_name: String
    let bundle_identifier: String?
    let executable_path: String
}

struct PermissionRequestResultPayload: Codable, Sendable {
    let permission: String
    let granted: Bool
    let prompt_triggered: Bool
    let message: String
}

struct HealthPayload: Codable, Sendable {
    let ok: Bool
    let host: String
    let port: Int
}

struct ClickRequest: Codable, Sendable {
    let element_description: String
    let app: String?
    let observation_capture: ObservationCapturePayload?
    let num_clicks: Int?
    let button_type: String?
    let hold_keys: [String]?
}

struct SwitchApplicationRequest: Codable, Sendable {
    let app_code: String
}

struct OpenRequest: Codable, Sendable {
    let app_or_filename: String?
    let url: String?
    let application: String?
    let ensure_window: Bool?
}

struct TypeRequest: Codable, Sendable {
    let element_description: String
    let app: String?
    let observation_capture: ObservationCapturePayload?
    let text: String
    let overwrite: Bool
    let enter: Bool

    init(
        element_description: String,
        app: String? = nil,
        observation_capture: ObservationCapturePayload? = nil,
        text: String = "",
        overwrite: Bool = false,
        enter: Bool = false)
    {
        self.element_description = element_description
        self.app = app
        self.observation_capture = observation_capture
        self.text = text
        self.overwrite = overwrite
        self.enter = enter
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.element_description = try container.decode(String.self, forKey: .element_description)
        self.app = try container.decodeIfPresent(String.self, forKey: .app)
        self.observation_capture = try container.decodeIfPresent(ObservationCapturePayload.self, forKey: .observation_capture)
        self.text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        self.overwrite = try container.decodeIfPresent(Bool.self, forKey: .overwrite) ?? false
        self.enter = try container.decodeIfPresent(Bool.self, forKey: .enter) ?? false
    }
}

struct DragRequest: Codable, Sendable {
    let starting_description: String
    let ending_description: String
    let app: String?
    let observation_capture: ObservationCapturePayload?
    let hold_keys: [String]?
}

struct ScrollRequestPayload: Codable, Sendable {
    let element_description: String
    let app: String?
    let observation_capture: ObservationCapturePayload?
    let clicks: Int
    let shift: Bool?
}

struct HotkeyRequest: Codable, Sendable {
    let keys: [String]
}

struct HoldAndPressRequest: Codable, Sendable {
    let hold_keys: [String]
    let press_keys: [String]
}

struct WaitRequest: Codable, Sendable {
    let time: Double
}

struct SeeRequestPayload: Codable, Sendable {
    let app: String?
    let window_title: String?
    let mode: String?
    let display_index: Int?
    let path: String?
    let annotate: Bool?
}

struct SeeElementPayload: Codable, Sendable {
    let id: String
    let role: String
    let title: String?
    let label: String?
    let description: String?
    let role_description: String?
    let help: String?
    let identifier: String?
    let is_actionable: Bool
    let keyboard_shortcut: String?
}

struct SeeResponse: Codable, Sendable {
    let action_id: String
    let ok: Bool
    let message: String
    let duration_ms: Int
    let snapshot_id: String
    let screenshot_raw: String
    let screenshot_annotated: String
    let ui_map: String
    let application_name: String?
    let window_title: String?
    let is_dialog: Bool
    let element_count: Int
    let interactable_count: Int
    let capture_mode: String
    let execution_time: Double
    let observation_capture: ObservationCapturePayload?
    let ui_elements: [SeeElementPayload]
}

struct ResolvedElement: Sendable {
    let appName: String?
    let windowTitle: String?
    let elementID: String
    let elementType: String
    let label: String?
    let bounds: CGRect
}

struct TargetContext: Sendable {
    let app: String?
    let windowTitle: String?
    let snapshotID: String?
    let elementID: String?
}

enum TargetIntent: Sendable {
    case click
    case type
    case drag
    case scroll
}

enum HTTPMethod: String, Sendable {
    case GET
    case POST
}

struct HTTPRequest: Sendable {
    let method: HTTPMethod
    let path: String
    let headers: [String: String]
    let body: Data

    var bearerToken: String? {
        guard let authorization = headers["authorization"] else { return nil }
        let prefix = "bearer "
        guard authorization.lowercased().hasPrefix(prefix) else { return nil }
        return String(authorization.dropFirst(prefix.count))
    }

    var observabilityRunID: String? {
        headers["x-observability-run-id"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct HTTPResponse: Sendable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data

    static func json<T: Encodable>(_ value: T, statusCode: Int = 200, encoder: JSONEncoder = JSONEncoder()) throws
        -> HTTPResponse
    {
        encoder.outputFormatting = [.sortedKeys]
        return HTTPResponse(
            statusCode: statusCode,
            headers: ["content-type": "application/json; charset=utf-8"],
            body: try encoder.encode(value))
    }
}

enum DesktopServerError: Error, Sendable {
    case targetNotFound(String)
    case targetAmbiguous(String, [String])
    case permissionDenied(String)
    case invalidInput(String)
    case serverUnavailable(String)

    var code: DesktopServerErrorCode {
        switch self {
        case .targetNotFound:
            .targetNotFound
        case .targetAmbiguous:
            .targetAmbiguous
        case .permissionDenied:
            .permissionDenied
        case .invalidInput:
            .invalidInput
        case .serverUnavailable:
            .serverUnavailable
        }
    }

    var message: String {
        switch self {
        case let .targetNotFound(message),
             let .targetAmbiguous(message, _),
             let .permissionDenied(message),
             let .invalidInput(message),
             let .serverUnavailable(message):
            message
        }
    }

    var candidates: [String]? {
        switch self {
        case let .targetAmbiguous(_, candidates):
            candidates
        default:
            nil
        }
    }

    var statusCode: Int {
        switch self {
        case .targetNotFound:
            404
        case .targetAmbiguous:
            409
        case .permissionDenied:
            403
        case .invalidInput:
            400
        case .serverUnavailable:
            503
        }
    }
}

extension DesktopServerError: LocalizedError, CustomStringConvertible {
    var errorDescription: String? {
        message
    }

    var description: String {
        message
    }
}
