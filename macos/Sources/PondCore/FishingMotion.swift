import Foundation

/// Shared clock for the four storyboard beats. All positions are scene-relative,
/// so resizing or reopening the pond cannot restart or misalign a catch.
public struct FishingMotion {
    public static let duration = 2.4
    public enum Phase: CaseIterable { case bite, pull, flight, celebrate }
    public let elapsed: Double
    public init(elapsed: Double) { self.elapsed = min(Self.duration, max(0, elapsed.isFinite ? elapsed : 0)) }
    public var phase: Phase {
        if elapsed < 0.4 { return .bite }
        if elapsed < 1.0 { return .pull }
        if elapsed < 1.8 { return .flight }
        return .celebrate
    }
    public var pullBlend: Double { ramp(0.4, 0.58) }
    public var liftBlend: Double { ramp(1.0, 1.18) }
    public var happyBlend: Double { ramp(1.8, 1.98) }
    public var fishOpacity: Double { ramp(1.0, 1.12) }
    public var bobberOpacity: Double { 1 - ramp(1.0, 1.12) }
    public var splashProgress: Double { min(1, max(0, (elapsed - 1.0) / 0.65)) }
    public var grip: CGPoint {
        let pull = mix(CGPoint(x: 0.325, y: 0.516), CGPoint(x: 0.298, y: 0.425), pullBlend)
        let lift = mix(pull, CGPoint(x: 0.353, y: 0.397), liftBlend)
        return mix(lift, CGPoint(x: 0.304, y: 0.510), happyBlend)
    }
    public var tip: CGPoint {
        var point = mix(CGPoint(x: 0.64, y: 0.325), CGPoint(x: 0.61, y: 0.27), ramp(0.4, 0.95))
        point = mix(point, CGPoint(x: 0.57, y: 0.15), ramp(1.0, 1.3))
        return mix(point, CGPoint(x: 0.475, y: 0.18), ramp(1.8, 2.1))
    }
    public var bend: CGPoint {
        var point = mix(CGPoint(x: 0.47, y: 0.335), CGPoint(x: 0.45, y: 0.095), ramp(0.4, 0.95))
        point = mix(point, CGPoint(x: 0.47, y: 0.105), ramp(1.0, 1.3))
        return mix(point, CGPoint(x: 0.405, y: 0.20), ramp(1.8, 2.1))
    }
    public var fishCenter: CGPoint {
        let p = min(1, max(0, (elapsed - 1.0) / 0.8))
        // Quadratic arc: fish leaves the ripple, rises, then lands beside the paw.
        let start = CGPoint(x: 0.70, y: 0.73)
        let control = CGPoint(x: 0.64, y: 0.10)
        let end = CGPoint(x: 0.485, y: 0.435)
        var point = CGPoint(x: pow(1-p, 2)*start.x + 2*(1-p)*p*control.x + p*p*end.x,
                            y: pow(1-p, 2)*start.y + 2*(1-p)*p*control.y + p*p*end.y)
        if elapsed > 1.8 {
            let t = elapsed - 1.8
            point.x += sin(t * 12) * 0.014 * exp(-t * 4)
            point.y += sin(t * 10) * 0.009 * exp(-t * 4)
        }
        return point
    }
    public var fishAngle: Double {
        elapsed < 1.8 ? -22 + 30 * ramp(1.0, 1.8) : 8 * cos((elapsed - 1.8) * 12) * exp(-(elapsed - 1.8) * 4)
    }
    private func ramp(_ start: Double, _ end: Double) -> Double {
        let p = min(1, max(0, (elapsed - start) / (end - start)))
        return p * p * (3 - 2 * p)
    }
    private func mix(_ a: CGPoint, _ b: CGPoint, _ p: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x-a.x)*p, y: a.y + (b.y-a.y)*p)
    }
}
