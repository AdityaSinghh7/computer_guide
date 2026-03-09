import Foundation
import PeekabooAutomationKit

private enum Environment {
    static func value(_ key: String, default defaultValue: String) -> String {
        guard let rawValue = ProcessInfo.processInfo.environment[key] else {
            return defaultValue
        }

        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? defaultValue : value
    }
}

@MainActor
@main
enum ComputerGuideDesktopServerMain {
    private static let permissionsService = PermissionsService()

    static func main() {
        let token = Environment.value("COMPUTER_GUIDE_DESKTOP_TOKEN", default: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            fputs("COMPUTER_GUIDE_DESKTOP_TOKEN must be set\n", stderr)
            exit(1)
        }

        let host = Environment.value("COMPUTER_GUIDE_DESKTOP_HOST", default: "127.0.0.1")
        let portValue = Environment.value("COMPUTER_GUIDE_DESKTOP_PORT", default: "47613")
        let observabilityLogPath = Environment.value(
            "COMPUTER_GUIDE_DESKTOP_SERVER_LOG_PATH",
            default: ".logs/desktop-server-actions.jsonl")
        guard let port = UInt16(portValue) else {
            fputs("Invalid COMPUTER_GUIDE_DESKTOP_PORT '\(portValue)'\n", stderr)
            exit(1)
        }

        let observability: LocalObservability
        do {
            observability = try LocalObservability(logPath: observabilityLogPath)
        } catch {
            fputs("Failed to initialize observability: \(error.localizedDescription)\n", stderr)
            exit(1)
        }

        do {
            try self.ensureStartupPermissions()
        } catch {
            fputs("Failed permission onboarding: \(error)\n", stderr)
            exit(1)
        }

        let controller = DesktopActionServer(
            host: host,
            port: Int(port),
            token: token,
            observability: observability)

        do {
            let server = try LoopbackHTTPServer(host: host, port: port) { request in
                await controller.handle(request)
            }
            try server.start()
            print("computer-guide-desktop-server listening on http://\(host):\(port)")

            // Keep the listener alive for the lifetime of the process.
            withExtendedLifetime(server) {
                RunLoop.main.run()
            }
        } catch {
            fputs("Failed to start server: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    private static func ensureStartupPermissions() throws {
        if self.permissionsService.checkAccessibilityPermission() {
            fputs("Accessibility permission already granted.\n", stderr)
        } else {
            fputs("Accessibility permission is required. Requesting permission...\n", stderr)
            _ = self.permissionsService.requestAccessibilityPermission(interactive: true)

            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                if self.permissionsService.checkAccessibilityPermission() {
                    fputs("Accessibility permission granted. Continuing startup.\n", stderr)
                    break
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            }

            guard self.permissionsService.checkAccessibilityPermission() else {
                throw DesktopServerError.permissionDenied(
                    "Accessibility permission was not granted in time. Enable Computer Guide Desktop Server in System Settings > Privacy & Security > Accessibility and restart the server.")
            }
        }

        if self.permissionsService.checkScreenRecordingPermission() {
            fputs("Screen Recording permission already granted.\n", stderr)
        } else {
            fputs("Screen Recording permission is required for see/screenshot. Requesting permission...\n", stderr)
            _ = self.permissionsService.requestScreenRecordingPermission(interactive: true)

            let deadline = Date().addingTimeInterval(20)
            while Date() < deadline {
                if self.permissionsService.checkScreenRecordingPermission() {
                    fputs("Screen Recording permission granted. Continuing startup.\n", stderr)
                    return
                }
                RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            }

            throw DesktopServerError.permissionDenied(
                "Screen Recording permission is still required. macOS should now show Computer Guide Desktop Server in System Settings > Privacy & Security > Screen & System Audio Recording. Enable it there, then restart the server.")
        }
    }
}
