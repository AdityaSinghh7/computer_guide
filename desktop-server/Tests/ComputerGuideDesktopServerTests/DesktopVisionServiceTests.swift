import CoreGraphics
import PeekabooAutomationKit
import XCTest
@testable import ComputerGuideDesktopServer

final class DesktopVisionServiceTests: XCTestCase {
    func testScreenModeSeeRequestDoesNotRequireAppActivation() {
        let request = SeeRequestPayload(
            app: "Google Chrome",
            window_title: nil,
            mode: "screen",
            display_index: nil,
            path: nil,
            annotate: false)

        XCTAssertFalse(DesktopActionServer.shouldActivateRequestedApplication(for: request))
    }

    func testWindowModeSeeRequestStillActivatesRequestedApp() {
        let request = SeeRequestPayload(
            app: "Google Chrome",
            window_title: nil,
            mode: "window",
            display_index: nil,
            path: nil,
            annotate: false)

        XCTAssertTrue(DesktopActionServer.shouldActivateRequestedApplication(for: request))
    }

    func testBestEffortPreferredDisplayIndexReturnsNilOnLookupFailure() {
        enum TestError: Error {
            case appNotRunning
        }

        let displayIndex = DesktopVisionService.bestEffortPreferredDisplayIndex(
            from: .failure(TestError.appNotRunning))

        XCTAssertNil(displayIndex)
    }

    func testBestEffortPreferredDisplayIndexUsesPreferredWindowOnSuccess() {
        let windows = [
            self.makeWindow(
                windowID: 10,
                title: "Background",
                screenIndex: 0,
                index: 2,
                isMainWindow: false,
                isOnScreen: true,
                isMinimized: false,
                bounds: CGRect(x: 0, y: 0, width: 800, height: 600)),
            self.makeWindow(
                windowID: 11,
                title: "Amazon",
                screenIndex: 1,
                index: 0,
                isMainWindow: true,
                isOnScreen: true,
                isMinimized: false,
                bounds: CGRect(x: 1200, y: 0, width: 1400, height: 900)),
        ]

        let displayIndex = DesktopVisionService.bestEffortPreferredDisplayIndex(
            from: .success(windows))

        XCTAssertEqual(displayIndex, 1)
    }

    private func makeWindow(
        windowID: Int,
        title: String,
        screenIndex: Int?,
        index: Int,
        isMainWindow: Bool,
        isOnScreen: Bool,
        isMinimized: Bool,
        bounds: CGRect) -> ServiceWindowInfo
    {
        ServiceWindowInfo(
            windowID: windowID,
            title: title,
            bounds: bounds,
            isMinimized: isMinimized,
            isMainWindow: isMainWindow,
            windowLevel: 0,
            alpha: 1.0,
            index: index,
            spaceID: nil,
            spaceName: nil,
            screenIndex: screenIndex,
            screenName: nil,
            layer: 0,
            isOnScreen: isOnScreen,
            sharingState: .readWrite,
            isExcludedFromWindowsMenu: false)
    }
}
