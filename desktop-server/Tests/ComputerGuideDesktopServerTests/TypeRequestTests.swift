import XCTest
@testable import ComputerGuideDesktopServer

final class TypeRequestTests: XCTestCase {
    func testDefaultsOverwriteAndEnterToFalseWhenOmitted() throws {
        let request = try self.decode(
            """
            {
              "element_description": "Search field",
              "text": "Dubai chocolate"
            }
            """)

        XCTAssertFalse(request.overwrite)
        XCTAssertFalse(request.enter)
    }

    func testPreservesOverwriteFalseAndEnterFalse() throws {
        let request = try self.decode(
            """
            {
              "element_description": "Search field",
              "text": "Dubai chocolate",
              "overwrite": false,
              "enter": false
            }
            """)

        XCTAssertFalse(request.overwrite)
        XCTAssertFalse(request.enter)
    }

    func testPreservesOverwriteTrueAndEnterFalse() throws {
        let request = try self.decode(
            """
            {
              "element_description": "Search field",
              "text": "Dubai chocolate",
              "overwrite": true,
              "enter": false
            }
            """)

        XCTAssertTrue(request.overwrite)
        XCTAssertFalse(request.enter)
    }

    func testPreservesOverwriteFalseAndEnterTrue() throws {
        let request = try self.decode(
            """
            {
              "element_description": "Search field",
              "text": "Dubai chocolate",
              "overwrite": false,
              "enter": true
            }
            """)

        XCTAssertFalse(request.overwrite)
        XCTAssertTrue(request.enter)
    }

    func testPreservesOverwriteTrueAndEnterTrue() throws {
        let request = try self.decode(
            """
            {
              "element_description": "Search field",
              "text": "Dubai chocolate",
              "overwrite": true,
              "enter": true
            }
            """)

        XCTAssertTrue(request.overwrite)
        XCTAssertTrue(request.enter)
    }

    private func decode(_ json: String) throws -> TypeRequest {
        try JSONDecoder().decode(TypeRequest.self, from: Data(json.utf8))
    }
}
