// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ComputerGuideDesktopServer",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .executable(
            name: "computer-guide-desktop-server",
            targets: ["ComputerGuideDesktopServer"]),
    ],
    dependencies: [
        .package(path: "../../Peekaboo"),
    ],
    targets: [
        .executableTarget(
            name: "ComputerGuideDesktopServer",
            dependencies: [
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooFoundation", package: "Peekaboo"),
            ]),
        .testTarget(
            name: "ComputerGuideDesktopServerTests",
            dependencies: ["ComputerGuideDesktopServer"]),
    ],
    swiftLanguageModes: [.v6])
