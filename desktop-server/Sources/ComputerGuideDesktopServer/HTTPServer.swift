import Foundation
import Network

final class LoopbackHTTPServer: @unchecked Sendable {
    private final class StartupState: @unchecked Sendable {
        private let lock = NSLock()
        let semaphore = DispatchSemaphore(value: 0)
        private(set) var error: Error?
        private var resolved = false

        func resolve(error: Error?) {
            lock.lock()
            defer { lock.unlock() }

            guard !resolved else { return }
            resolved = true
            self.error = error
            semaphore.signal()
        }
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "computer-guide.desktop-server.http")
    private let handler: @Sendable (HTTPRequest) async -> HTTPResponse
    private let startupTimeoutSeconds: TimeInterval = 5
    private let startupLoggingEnabled: Bool

    init(host: String, port: UInt16, handler: @escaping @Sendable (HTTPRequest) async -> HTTPResponse) throws {
        guard host == "127.0.0.1" else {
            throw DesktopServerError.invalidInput("Only 127.0.0.1 is supported for the desktop server")
        }
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw DesktopServerError.invalidInput("Invalid port \(port)")
        }
        self.listener = try NWListener(using: .tcp, on: nwPort)
        self.handler = handler
        self.startupLoggingEnabled =
            ProcessInfo.processInfo.environment["COMPUTER_GUIDE_DESKTOP_DEBUG_STARTUP"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased() == "1"
    }

    func start() throws {
        let startupState = StartupState()

        listener.stateUpdateHandler = { state in
            if self.startupLoggingEnabled {
                fputs("HTTP listener state: \(String(describing: state))\n", stderr)
            }
            switch state {
            case .ready:
                startupState.resolve(error: nil)
            case let .failed(error):
                startupState.resolve(
                    error: DesktopServerError.serverUnavailable(
                        "HTTP listener failed to start: \(error.localizedDescription)"))
            case .cancelled:
                startupState.resolve(
                    error: DesktopServerError.serverUnavailable(
                        "HTTP listener was cancelled during startup"))
            case .setup, .waiting:
                break
            @unknown default:
                startupState.resolve(
                    error: DesktopServerError.serverUnavailable(
                        "HTTP listener entered an unknown startup state"))
            }
        }

        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection: connection)
        }
        listener.start(queue: queue)

        let waitResult = startupState.semaphore.wait(timeout: .now() + startupTimeoutSeconds)
        if waitResult == .timedOut {
            listener.cancel()
            throw DesktopServerError.serverUnavailable(
                "HTTP listener did not become ready within \(Int(startupTimeoutSeconds)) seconds")
        }

        if let startupError = startupState.error {
            throw startupError
        }
    }

    private func handle(connection: NWConnection) {
        connection.start(queue: queue)
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }

            switch state {
            case .ready:
                let remoteEndpoint = connection.currentPath?.remoteEndpoint ?? connection.endpoint
                guard self.isLoopback(remoteEndpoint) else {
                    let response = self.errorResponse(.permissionDenied("Only loopback clients may connect"))
                    self.send(response, on: connection)
                    return
                }
                self.receive(on: connection, buffer: Data())
            case .failed, .cancelled:
                connection.cancel()
            case .setup, .waiting, .preparing:
                break
            @unknown default:
                connection.cancel()
            }
        }
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }

            if let error {
                let response = self.errorResponse(
                    DesktopServerError.serverUnavailable("Connection failure: \(error.localizedDescription)"))
                self.send(response, on: connection)
                return
            }

            var nextBuffer = buffer
            if let data {
                nextBuffer.append(data)
            }

            if let request = self.parseRequest(from: nextBuffer) {
                Task {
                    let response = await self.handler(request)
                    self.send(response, on: connection)
                }
                return
            }

            if isComplete {
                let response = self.errorResponse(.invalidInput("Malformed HTTP request"))
                self.send(response, on: connection)
                return
            }

            self.receive(on: connection, buffer: nextBuffer)
        }
    }

    private func send(_ response: HTTPResponse, on connection: NWConnection) {
        let data = serialize(response)
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func serialize(_ response: HTTPResponse) -> Data {
        let statusText = switch response.statusCode {
        case 200: "OK"
        case 400: "Bad Request"
        case 401: "Unauthorized"
        case 403: "Forbidden"
        case 404: "Not Found"
        case 405: "Method Not Allowed"
        case 409: "Conflict"
        case 500: "Internal Server Error"
        case 503: "Service Unavailable"
        default: "OK"
        }

        var headerLines = [
            "HTTP/1.1 \(response.statusCode) \(statusText)",
            "Content-Length: \(response.body.count)",
            "Connection: close",
        ]

        for (key, value) in response.headers {
            headerLines.append("\(key): \(value)")
        }

        let headerData = Data((headerLines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
        return headerData + response.body
    }

    private func parseRequest(from data: Data) -> HTTPRequest? {
        let separator = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: separator) else { return nil }

        let headerData = data[..<range.lowerBound]
        let bodyStart = range.upperBound
        guard let headerString = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerString.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }

        let requestParts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard requestParts.count >= 2,
              let method = HTTPMethod(rawValue: String(requestParts[0]))
        else {
            return nil
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separatorIndex = line.firstIndex(of: ":") else { continue }
            let key = String(line[..<separatorIndex]).trimmingCharacters(in: .whitespaces).lowercased()
            let value = String(line[line.index(after: separatorIndex)...]).trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }

        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        let expectedLength = bodyStart + contentLength
        guard data.count >= expectedLength else { return nil }

        let body = data[bodyStart..<expectedLength]
        return HTTPRequest(
            method: method,
            path: String(requestParts[1]),
            headers: headers,
            body: Data(body))
    }

    private func errorResponse(_ error: DesktopServerError) -> HTTPResponse {
        let envelope = ErrorResponse(error: ErrorEnvelope(code: error.code, message: error.message, candidates: error.candidates))
        return (try? HTTPResponse.json(envelope, statusCode: error.statusCode)) ?? HTTPResponse(
            statusCode: 500,
            headers: ["content-type": "application/json; charset=utf-8"],
            body: Data("{\"error\":{\"code\":\"SERVER_UNAVAILABLE\",\"message\":\"Failed to encode error\"}}".utf8))
    }

    private func isLoopback(_ endpoint: NWEndpoint) -> Bool {
        guard case let .hostPort(host, _) = endpoint else { return false }
        let value = "\(host)"
        return value == "127.0.0.1" || value == "::1" || value == "::ffff:127.0.0.1"
    }
}
