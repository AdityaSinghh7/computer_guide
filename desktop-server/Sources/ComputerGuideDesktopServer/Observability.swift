import Foundation

actor LocalObservability {
    private let logURL: URL

    init(logPath: String) throws {
        self.logURL = URL(
            fileURLWithPath: logPath,
            relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
            .standardizedFileURL

        let directoryURL = self.logURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: self.logURL.path) {
            FileManager.default.createFile(atPath: self.logURL.path, contents: nil)
        }
    }

    func record(serializedEvent data: Data) async {
        do {
            guard var line = String(data: data, encoding: .utf8) else { return }
            line.append("\n")

            let handle = try FileHandle(forWritingTo: self.logURL)
            defer {
                try? handle.close()
            }

            try handle.seekToEnd()
            try handle.write(contentsOf: Data(line.utf8))
        } catch {
            fputs("Failed to write desktop server observability event: \(error.localizedDescription)\n", stderr)
        }
    }
}
