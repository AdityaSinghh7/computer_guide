import CoreGraphics
import XCTest
@testable import ComputerGuideDesktopServer

final class GroundingServiceTests: XCTestCase {
    func testMapsWindowRelativePointOnPrimaryDisplay() {
        let point = GroundingService.mapScreenshotPointToScreen(
            CGPoint(x: 400, y: 300),
            imageSize: CGSize(width: 800, height: 600),
            captureBounds: CGRect(x: 100, y: 80, width: 800, height: 600))

        XCTAssertEqual(point.x, 500, accuracy: 0.001)
        XCTAssertEqual(point.y, 380, accuracy: 0.001)
    }

    func testMapsPointOnSecondaryDisplayWithOffsetBounds() {
        let point = GroundingService.mapScreenshotPointToScreen(
            CGPoint(x: 960, y: 540),
            imageSize: CGSize(width: 1920, height: 1080),
            captureBounds: CGRect(x: 2560, y: 120, width: 1920, height: 1080))

        XCTAssertEqual(point.x, 3520, accuracy: 0.001)
        XCTAssertEqual(point.y, 660, accuracy: 0.001)
    }

    func testMapsNativeScaleScreenshotBackToLogicalWindowBounds() {
        let point = GroundingService.mapScreenshotPointToScreen(
            CGPoint(x: 1200, y: 800),
            imageSize: CGSize(width: 2400, height: 1600),
            captureBounds: CGRect(x: 300, y: 200, width: 1200, height: 800))

        XCTAssertEqual(point.x, 900, accuracy: 0.001)
        XCTAssertEqual(point.y, 600, accuracy: 0.001)
    }

    func testClampsOutOfRangeCoordinatesToCaptureBounds() {
        let point = GroundingService.mapScreenshotPointToScreen(
            CGPoint(x: -50, y: 1000),
            imageSize: CGSize(width: 400, height: 300),
            captureBounds: CGRect(x: 50, y: 75, width: 400, height: 300))

        XCTAssertEqual(point.x, 50, accuracy: 0.001)
        XCTAssertEqual(point.y, 375, accuracy: 0.001)
    }

    func testMapsPointWithinFullScreenCaptureOnOffsetDisplay() {
        let point = GroundingService.mapScreenshotPointToScreen(
            CGPoint(x: 660, y: 116),
            imageSize: CGSize(width: 1920, height: 1055),
            captureBounds: CGRect(x: 1512, y: -73, width: 1920, height: 1055))

        XCTAssertEqual(point.x, 2172, accuracy: 0.001)
        XCTAssertEqual(point.y, 43, accuracy: 0.001)
    }

    func testMapsNativeScaleScreenshotBackToLogicalFullScreenBounds() {
        let point = GroundingService.mapScreenshotPointToScreen(
            CGPoint(x: 1728, y: 48),
            imageSize: CGSize(width: 3456, height: 2234),
            captureBounds: CGRect(x: 0, y: 0, width: 1728, height: 1117))

        XCTAssertEqual(point.x, 864, accuracy: 0.001)
        XCTAssertEqual(point.y, 24, accuracy: 0.001)
    }
}
