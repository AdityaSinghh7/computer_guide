import AppKit
import CoreGraphics
import Foundation
import PeekabooFoundation

enum MouseButtonKind: String {
    case left
    case right
    case middle
}

@MainActor
final class CustomInputPerformer {
    func performPointerClick(
        at point: CGPoint,
        button: MouseButtonKind,
        clickCount: Int,
        modifiers: [String]) throws
    {
        let flags = try self.flags(from: modifiers)
        let source = CGEventSource(stateID: .hidSystemState)

        for index in 1...max(clickCount, 1) {
            let (downType, upType, mouseButton) = self.mouseEventKinds(for: button)
            guard let down = CGEvent(
                mouseEventSource: source,
                mouseType: downType,
                mouseCursorPosition: point,
                mouseButton: mouseButton),
                let up = CGEvent(
                    mouseEventSource: source,
                    mouseType: upType,
                    mouseCursorPosition: point,
                    mouseButton: mouseButton)
            else {
                throw DesktopServerError.serverUnavailable("Failed to create mouse event")
            }

            down.flags = flags
            up.flags = flags
            down.setIntegerValueField(.mouseEventClickState, value: Int64(index))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(index))
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)

            if index < clickCount {
                Thread.sleep(forTimeInterval: 0.08)
            }
        }
    }

    func performHeldKeySequence(holdKeys: [String], pressKeys: [String]) throws {
        let holdCodes = try holdKeys.map(self.keyDescriptor(for:))
        let pressDescriptors = try pressKeys.map(self.keyDescriptor(for:))

        for descriptor in holdCodes {
            try postKey(descriptor, isDown: true)
        }

        for descriptor in pressDescriptors {
            try postKey(descriptor, isDown: true)
            try postKey(descriptor, isDown: false)
        }

        for descriptor in holdCodes.reversed() {
            try postKey(descriptor, isDown: false)
        }
    }

    private func postKey(_ descriptor: KeyDescriptor, isDown: Bool) throws {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: descriptor.keyCode, keyDown: isDown) else {
            throw DesktopServerError.serverUnavailable("Failed to create keyboard event")
        }
        event.flags = descriptor.flags
        if let text = descriptor.text, !text.isEmpty {
            let utf16 = Array(text.utf16)
            event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        }
        event.post(tap: .cghidEventTap)
    }

    private func mouseEventKinds(for button: MouseButtonKind) -> (CGEventType, CGEventType, CGMouseButton) {
        switch button {
        case .left:
            (.leftMouseDown, .leftMouseUp, .left)
        case .right:
            (.rightMouseDown, .rightMouseUp, .right)
        case .middle:
            (.otherMouseDown, .otherMouseUp, .center)
        }
    }

    private func flags(from modifiers: [String]) throws -> CGEventFlags {
        try modifiers.reduce(into: CGEventFlags()) { flags, modifier in
            switch modifier.lowercased() {
            case "cmd", "command":
                flags.insert(.maskCommand)
            case "ctrl", "control":
                flags.insert(.maskControl)
            case "alt", "option", "opt":
                flags.insert(.maskAlternate)
            case "shift":
                flags.insert(.maskShift)
            case "fn", "function":
                flags.insert(.maskSecondaryFn)
            default:
                throw DesktopServerError.invalidInput("Unsupported modifier key '\(modifier)'")
            }
        }
    }

    private struct KeyDescriptor {
        let keyCode: CGKeyCode
        let flags: CGEventFlags
        let text: String?
    }

    private func keyDescriptor(for rawKey: String) throws -> KeyDescriptor {
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch key {
        case "cmd", "command":
            return KeyDescriptor(keyCode: 0x37, flags: .maskCommand, text: nil)
        case "shift":
            return KeyDescriptor(keyCode: 0x38, flags: .maskShift, text: nil)
        case "alt", "option", "opt":
            return KeyDescriptor(keyCode: 0x3A, flags: .maskAlternate, text: nil)
        case "ctrl", "control":
            return KeyDescriptor(keyCode: 0x3B, flags: .maskControl, text: nil)
        case "fn", "function":
            return KeyDescriptor(keyCode: 0x3F, flags: .maskSecondaryFn, text: nil)
        case "return", "enter":
            return KeyDescriptor(keyCode: 0x24, flags: [], text: nil)
        case "tab":
            return KeyDescriptor(keyCode: 0x30, flags: [], text: nil)
        case "space":
            return KeyDescriptor(keyCode: 0x31, flags: [], text: " ")
        case "escape", "esc":
            return KeyDescriptor(keyCode: 0x35, flags: [], text: nil)
        case "delete", "backspace":
            return KeyDescriptor(keyCode: 0x33, flags: [], text: nil)
        case "forward_delete":
            return KeyDescriptor(keyCode: 0x75, flags: [], text: nil)
        case "left":
            return KeyDescriptor(keyCode: 0x7B, flags: [], text: nil)
        case "right":
            return KeyDescriptor(keyCode: 0x7C, flags: [], text: nil)
        case "down":
            return KeyDescriptor(keyCode: 0x7D, flags: [], text: nil)
        case "up":
            return KeyDescriptor(keyCode: 0x7E, flags: [], text: nil)
        default:
            if let code = Self.characterKeycodes[key] {
                return KeyDescriptor(keyCode: code, flags: [], text: nil)
            }
            throw DesktopServerError.invalidInput("Unsupported key '\(rawKey)'")
        }
    }

    private static let characterKeycodes: [String: CGKeyCode] = [
        "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05,
        "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C,
        "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11, "1": 0x12,
        "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18,
        "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E,
        "o": 0x1F, "u": 0x20, "[": 0x21, "i": 0x22, "p": 0x23, "l": 0x25,
        "j": 0x26, "'": 0x27, "k": 0x28, ";": 0x29, "\\": 0x2A, ",": 0x2B,
        "/": 0x2C, "n": 0x2D, "m": 0x2E, ".": 0x2F,
    ]
}
