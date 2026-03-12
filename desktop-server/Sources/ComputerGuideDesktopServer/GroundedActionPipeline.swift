import CoreGraphics
import Foundation

struct GroundedActionTarget: Sendable {
    let role: String
    let point: GroundedPoint
}

struct GroundedActionExecutionArtifact: Sendable {
    let before: GroundingCaptureArtifact?
    let after: GroundingCaptureArtifact?
    let targets: [GroundedActionTarget]
}

@MainActor
final class GroundedActionPipeline {
    private let groundingService: GroundingService

    init(groundingService: GroundingService) {
        self.groundingService = groundingService
    }

    func executeSingle(
        description: String,
        app: String?,
        observationCapture: ObservationCapturePayload?,
        observabilityContext: GroundingObservabilityContext,
        perform: @escaping @MainActor @Sendable (GroundedPoint) async throws -> Void) async throws -> GroundedActionExecutionArtifact
    {
        let grounded = try await self.groundingService.ground(
            elementDescription: description,
            app: app,
            observationCapture: observationCapture,
            observabilityContext: observabilityContext)
        try await perform(grounded)
        let after = try await self.groundingService.captureArtifact(
            app: app,
            observationCapture: observationCapture,
            observabilityContext: observabilityContext)
        return GroundedActionExecutionArtifact(
            before: grounded.screenshotPath.map {
                GroundingCaptureArtifact(
                    screenshotPath: $0,
                    captureBounds: grounded.captureBounds,
                    applicationName: grounded.applicationName,
                    windowTitle: grounded.windowTitle)
            },
            after: after,
            targets: [
                GroundedActionTarget(role: "primary", point: grounded),
            ])
    }

    func executeDual(
        firstDescription: String,
        secondDescription: String,
        app: String?,
        observationCapture: ObservationCapturePayload?,
        observabilityContext: GroundingObservabilityContext,
        perform: @escaping @MainActor @Sendable (GroundedPoint, GroundedPoint) async throws -> Void) async throws -> GroundedActionExecutionArtifact
    {
        let first = try await self.groundingService.ground(
            elementDescription: firstDescription,
            app: app,
            observationCapture: observationCapture,
            observabilityContext: observabilityContext)
        let second = try await self.groundingService.ground(
            elementDescription: secondDescription,
            app: app,
            observationCapture: observationCapture,
            observabilityContext: observabilityContext)
        try await perform(first, second)
        let after = try await self.groundingService.captureArtifact(
            app: app,
            observationCapture: observationCapture,
            observabilityContext: observabilityContext)
        return GroundedActionExecutionArtifact(
            before: first.screenshotPath.map {
                GroundingCaptureArtifact(
                    screenshotPath: $0,
                    captureBounds: first.captureBounds,
                    applicationName: first.applicationName,
                    windowTitle: first.windowTitle)
            },
            after: after,
            targets: [
                GroundedActionTarget(role: "start", point: first),
                GroundedActionTarget(role: "end", point: second),
            ])
    }
}
