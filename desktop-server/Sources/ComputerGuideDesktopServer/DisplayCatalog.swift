import CoreGraphics
import Foundation

struct DisplayCatalogEntry: Sendable {
    let id: CGDirectDisplayID
    let index: Int
    let bounds: CGRect
}

enum DisplayCatalog {
    static func activeDisplays() throws -> [DisplayCatalogEntry] {
        var displayCount: UInt32 = 0
        var error = CGGetActiveDisplayList(0, nil, &displayCount)
        guard error == .success else {
            throw DesktopServerError.serverUnavailable(
                "Failed to enumerate active displays (\(error.rawValue))")
        }

        guard displayCount > 0 else {
            return []
        }

        var displayIDs = Array(repeating: CGDirectDisplayID(), count: Int(displayCount))
        error = CGGetActiveDisplayList(displayCount, &displayIDs, &displayCount)
        guard error == .success else {
            throw DesktopServerError.serverUnavailable(
                "Failed to enumerate active displays (\(error.rawValue))")
        }

        return displayIDs
            .prefix(Int(displayCount))
            .enumerated()
            .map { offset, id in
                DisplayCatalogEntry(
                    id: id,
                    index: offset,
                    bounds: CGDisplayBounds(id))
            }
    }

    static func entry(displayID: CGDirectDisplayID?, bounds: CGRect?) throws -> DisplayCatalogEntry? {
        try self.entry(
            displayID: displayID,
            bounds: bounds,
            within: self.activeDisplays())
    }

    static func entry(
        displayID: CGDirectDisplayID?,
        bounds: CGRect?,
        within displays: [DisplayCatalogEntry]) -> DisplayCatalogEntry?
    {
        if let displayID,
           let match = displays.first(where: { $0.id == displayID })
        {
            return match
        }

        guard let bounds else {
            return nil
        }
        return self.bestMatch(for: bounds, within: displays)
    }

    static func bestMatch(for bounds: CGRect, within displays: [DisplayCatalogEntry]) -> DisplayCatalogEntry? {
        guard let match = displays.max(by: { lhs, rhs in
            self.intersectionArea(of: lhs.bounds, with: bounds)
                < self.intersectionArea(of: rhs.bounds, with: bounds)
        }) else {
            return nil
        }

        guard self.intersectionArea(of: match.bounds, with: bounds) > 0 else {
            return nil
        }
        return match
    }

    private static func intersectionArea(of lhs: CGRect, with rhs: CGRect) -> CGFloat {
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, !intersection.isEmpty else {
            return 0
        }
        return intersection.width * intersection.height
    }
}
