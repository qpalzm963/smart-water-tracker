import SwiftUI
import AppKit
import PondCore

/// Natively painted species in the storybook watercolor style of the fish atlases:
/// layered translucent washes, darker pigment edges, soft blooms, paper granulation,
/// fine fin rays and the same big amber eyes. Drawn on a 500 × 400 canvas facing right,
/// then cropped to its measured extent the way atlas fish are cropped by `spriteBounds`.
struct PaintedFish: View {
    let species: FishSpecies
    static let canvas = CGSize(width: 500, height: 400)

    /// Measured extent of each painting on the canvas, padded, so it fills its frame like an atlas crop.
    var contentBounds: CGRect {
        let measured: CGRect
        switch species {
        case .sakura: measured = CGRect(x: 55, y: 38, width: 370, height: 313)
        case .lemon: measured = CGRect(x: 44, y: 31, width: 369, height: 311)
        case .strawberry: measured = CGRect(x: 63, y: 47, width: 344, height: 315)
        case .pebble: measured = CGRect(x: 56, y: 100, width: 369, height: 240)
        case .cloud: measured = CGRect(x: 40, y: 58, width: 382, height: 274)
        case .bubble: measured = CGRect(x: 76, y: 63, width: 388, height: 279)
        case .maple: measured = CGRect(x: 63, y: 68, width: 381, height: 250)
        case .ribbon: measured = CGRect(x: 24, y: 70, width: 440, height: 268)
        case .lantern: measured = CGRect(x: 48, y: 30, width: 449, height: 333)
        case .aurora: measured = CGRect(x: 13, y: 32, width: 432, height: 323)
        default: measured = CGRect(origin: .zero, size: Self.canvas)
        }
        return measured.insetBy(dx: -8, dy: -8)
    }

    /// The layered washes are costly, so each species is painted once and reused by swimming fish.
    private static var cache: [FishSpecies: NSImage] = [:]
    @MainActor static func image(for species: FishSpecies) -> NSImage {
        if let cached = cache[species] { return cached }
        let fish = PaintedFish(species: species)
        let bounds = fish.contentBounds
        let renderer = ImageRenderer(content: fish.frame(width: bounds.width, height: bounds.height))
        renderer.scale = 2
        let image = renderer.nsImage ?? NSImage(size: bounds.size)
        cache[species] = image
        return image
    }

    var body: some View {
        Canvas { context, size in
            let bounds = contentBounds
            let scale = min(size.width / bounds.width, size.height / bounds.height)
            context.translateBy(x: (size.width - bounds.width * scale) / 2 - bounds.minX * scale,
                                y: (size.height - bounds.height * scale) / 2 - bounds.minY * scale)
            context.scaleBy(x: scale, y: scale)
            var painter = FishPainter(context: context, seed: species.rawValue)
            painter.paint(species)
        }
    }
}

private struct FishPalette {
    let body: Color, deep: Color, belly: Color, fin: Color, finDeep: Color
    init(_ body: UInt32, _ deep: UInt32, _ belly: UInt32, _ fin: UInt32, _ finDeep: UInt32) {
        self.body = Color(hex: body); self.deep = Color(hex: deep); self.belly = Color(hex: belly)
        self.fin = Color(hex: fin); self.finDeep = Color(hex: finDeep)
    }
}

private extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
    static let eyeInk = Color(hex: 0x2E1F16)
    static let blush = Color(hex: 0xF08F8F)
}

/// Deterministic per species, so the painting is identical on every frame and launch.
private struct PaintRandom {
    private var state: UInt64
    init(_ seed: String) {
        state = seed.utf8.reduce(1469598103934665603) { ($0 ^ UInt64($1)) &* 1099511628211 }
    }
    mutating func next() -> Double {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
    }
    mutating func range(_ lower: Double, _ upper: Double) -> Double { lower + (upper - lower) * next() }
}

private struct Body {
    let center: CGPoint, length: CGFloat, height: CGFloat
    var belly: CGFloat = 1
    var pinch: CGFloat = 0.13
    var nose: CGPoint { CGPoint(x: center.x + length / 2, y: center.y + height * 0.04) }
    var tailTop: CGPoint { CGPoint(x: center.x - length / 2, y: center.y - height * pinch) }
    var tailBottom: CGPoint { CGPoint(x: center.x - length / 2, y: center.y + height * pinch) }
    var tailRoot: CGPoint { CGPoint(x: center.x - length / 2 + 6, y: center.y) }
    var eye: CGPoint { CGPoint(x: center.x + length * 0.30, y: center.y - height * 0.08) }
    var eyeRadius: CGFloat { min(height * 0.13, 21) }
    func top(_ t: CGFloat) -> CGPoint { point(t, sign: -1) }
    func bottom(_ t: CGFloat) -> CGPoint { point(t, sign: belly) }
    /// Approximate silhouette edge at `t` (0 = tail, 1 = nose), used to seat fins on the body.
    private func point(_ t: CGFloat, sign: CGFloat) -> CGPoint {
        let x = center.x - length / 2 + length * t
        let profile = pow(sin(CGFloat.pi * min(max(t * 0.92 + 0.06, 0), 1)), 0.75)
        return CGPoint(x: x, y: center.y + sign * height / 2 * max(profile, pinch * 2) + height * 0.02)
    }
    var path: Path {
        let c = center, l = length, h = height
        var p = Path()
        p.move(to: nose)
        p.addCurve(to: CGPoint(x: c.x + l * 0.04, y: c.y - h / 2),
                   control1: CGPoint(x: nose.x - l * 0.01, y: c.y - h * 0.30),
                   control2: CGPoint(x: c.x + l * 0.30, y: c.y - h / 2))
        p.addCurve(to: tailTop, control1: CGPoint(x: c.x - l * 0.24, y: c.y - h / 2),
                   control2: CGPoint(x: tailTop.x + l * 0.14, y: tailTop.y - h * 0.06))
        p.addQuadCurve(to: tailBottom, control: CGPoint(x: tailTop.x - 4, y: c.y))
        p.addCurve(to: CGPoint(x: c.x + l * 0.02, y: c.y + h / 2 * belly),
                   control1: CGPoint(x: tailBottom.x + l * 0.14, y: tailBottom.y + h * 0.06),
                   control2: CGPoint(x: c.x - l * 0.24, y: c.y + h / 2 * belly))
        p.addCurve(to: nose, control1: CGPoint(x: c.x + l * 0.30, y: c.y + h / 2 * belly),
                   control2: CGPoint(x: nose.x - l * 0.01, y: c.y + h * 0.32))
        p.closeSubpath()
        return p
    }
}

// MARK: - Shapes

private enum Shapes {
    /// A fin rooted between `a` and `b`, with a scalloped outer edge through `edge`.
    static func fan(_ a: CGPoint, _ b: CGPoint, edge: [CGPoint], scallop: CGFloat = 0.18) -> Path {
        let root = mid(a, b)
        var p = Path()
        p.move(to: a)
        var previous = a
        for (index, point) in edge.enumerated() {
            if index == 0 {
                p.addQuadCurve(to: point, control: lerp(previous, point, 0.5))
            } else {
                let m = mid(previous, point)
                let out = CGPoint(x: m.x - root.x, y: m.y - root.y)
                let length = max(hypot(out.x, out.y), 1)
                let push = hypot(point.x - previous.x, point.y - previous.y) * scallop
                p.addQuadCurve(to: point, control: CGPoint(x: m.x + out.x / length * push, y: m.y + out.y / length * push))
            }
            previous = point
        }
        p.addQuadCurve(to: b, control: lerp(previous, b, 0.5))
        p.closeSubpath()
        return p
    }

    static func rays(_ a: CGPoint, _ b: CGPoint, edge: [CGPoint], count: Int = 9, reach: CGFloat = 0.9) -> Path {
        var p = Path()
        guard edge.count > 1 else { return p }
        for i in 0..<count {
            let t = CGFloat(i) / CGFloat(count - 1)
            let base = lerp(a, b, t)
            let position = t * CGFloat(edge.count - 1)
            let index = min(Int(position), edge.count - 2)
            let tip = lerp(edge[index], edge[index + 1], position - CGFloat(index))
            p.move(to: base)
            p.addQuadCurve(to: lerp(base, tip, reach), control: lerp(base, tip, 0.5).offset(0, -2))
        }
        return p
    }

    /// Leaf or petal from `base` toward `tip`; `notch` carves the sakura petal's tip.
    static func leaf(_ base: CGPoint, _ tip: CGPoint, width: CGFloat, notch: CGFloat = 0) -> Path {
        let dx = tip.x - base.x, dy = tip.y - base.y
        let length = max(hypot(dx, dy), 1)
        let n = CGPoint(x: -dy / length * width, y: dx / length * width)
        let bodyMid = lerp(base, tip, 0.45)
        var p = Path()
        p.move(to: base)
        if notch > 0 {
            let back = lerp(tip, base, notch / length)
            let side = CGPoint(x: n.x * 0.28, y: n.y * 0.28)
            p.addQuadCurve(to: tip.offset(side.x, side.y), control: bodyMid.offset(n.x * 1.2, n.y * 1.2))
            p.addLine(to: back)
            p.addLine(to: tip.offset(-side.x, -side.y))
            p.addQuadCurve(to: base, control: bodyMid.offset(-n.x * 1.2, -n.y * 1.2))
        } else {
            p.addQuadCurve(to: tip, control: bodyMid.offset(n.x, n.y))
            p.addQuadCurve(to: base, control: bodyMid.offset(-n.x, -n.y))
        }
        p.closeSubpath()
        return p
    }

    static func veins(_ base: CGPoint, _ tip: CGPoint, width: CGFloat, pairs: Int = 4) -> Path {
        var p = Path()
        p.move(to: base); p.addLine(to: lerp(base, tip, 0.92))
        let dx = tip.x - base.x, dy = tip.y - base.y
        let length = max(hypot(dx, dy), 1)
        let n = CGPoint(x: -dy / length, y: dx / length)
        for i in 1...pairs {
            let t = CGFloat(i) / CGFloat(pairs + 1)
            let start = lerp(base, tip, t * 0.9)
            let spread = width * 0.62 * sin(.pi * min(t + 0.1, 1))
            for side in [-1.0, 1.0] {
                let end = lerp(base, tip, min(t * 0.9 + 0.16, 0.96)).offset(n.x * spread * side, n.y * spread * side)
                p.move(to: start); p.addQuadCurve(to: end, control: lerp(start, end, 0.5).offset(dx / length * 3, dy / length * 3))
            }
        }
        return p
    }

    /// Five pointed maple lobes around `center`, pointing along `angle`.
    static func maple(center: CGPoint, radius: CGFloat, angle: CGFloat) -> Path {
        let lobes: [(CGFloat, CGFloat)] = [(0, 1), (0.78, 0.82), (-0.78, 0.82), (1.55, 0.55), (-1.55, 0.55)]
        var points: [CGPoint] = []
        for (offset, reach) in lobes.sorted(by: { $0.0 < $1.0 }) {
            let a = angle + offset
            points.append(CGPoint(x: center.x + cos(a) * radius * reach, y: center.y + sin(a) * radius * reach))
        }
        var p = Path()
        let stem = CGPoint(x: center.x - cos(angle) * radius * 0.35, y: center.y - sin(angle) * radius * 0.35)
        p.move(to: stem)
        var previousAngle = angle - 2.2
        for (i, point) in points.enumerated() {
            let a = angle + lobes.sorted(by: { $0.0 < $1.0 })[i].0
            let valleyAngle = (previousAngle + a) / 2
            let valley = CGPoint(x: center.x + cos(valleyAngle) * radius * 0.34, y: center.y + sin(valleyAngle) * radius * 0.34)
            p.addQuadCurve(to: valley, control: lerp(p.currentPoint ?? stem, valley, 0.5))
            p.addLine(to: point)
            previousAngle = a
        }
        let last = CGPoint(x: center.x + cos(angle + 2.2) * radius * 0.30, y: center.y + sin(angle + 2.2) * radius * 0.30)
        p.addLine(to: last)
        p.addQuadCurve(to: stem, control: center)
        p.closeSubpath()
        return p
    }

    /// Merged puffs, so the pigment edge follows only the cloud's outline.
    static func cloud(_ puffs: [(CGPoint, CGFloat)]) -> Path {
        puffs.reduce(Path()) { $0.union(circle($1.0, $1.1)) }
    }

    static func star(_ center: CGPoint, _ radius: CGFloat) -> Path {
        var p = Path()
        for i in 0..<8 {
            let a = CGFloat(i) * .pi / 4 - .pi / 2
            let r = i % 2 == 0 ? radius : radius * 0.28
            let point = CGPoint(x: center.x + cos(a) * r, y: center.y + sin(a) * r)
            i == 0 ? p.move(to: point) : p.addLine(to: point)
        }
        p.closeSubpath()
        return p
    }

    static func circle(_ center: CGPoint, _ radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    }

    static func lerp(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }
    static func mid(_ a: CGPoint, _ b: CGPoint) -> CGPoint { lerp(a, b, 0.5) }
}

private extension CGPoint {
    func offset(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: self.x + x, y: self.y + y) }
}

// MARK: - Painter

private struct FishPainter {
    let context: GraphicsContext
    var random: PaintRandom
    init(context: GraphicsContext, seed: String) {
        self.context = context
        random = PaintRandom(seed)
    }

    /// One watercolor layer: soft wash, offset glaze, lit centre, blooms, darker pigment edge, granulation.
    mutating func wash(_ path: Path, _ shading: GraphicsContext.Shading, deep: Color,
                       opacity: Double = 0.9, edge: CGFloat = 2.2, grain: Int = 1) {
        let box = path.boundingRect
        var base = context
        base.opacity = opacity
        base.addFilter(.blur(radius: 0.7))
        base.fill(path, with: shading)

        var glaze = context
        glaze.opacity = opacity * 0.32
        glaze.translateBy(x: random.range(-2, 2), y: random.range(-2, 1))
        glaze.clip(to: path)
        glaze.fill(path, with: shading)

        var inside = context
        inside.clip(to: path)
        inside.fill(Path(ellipseIn: box.insetBy(dx: box.width * 0.08, dy: box.height * 0.1).offsetBy(dx: -box.width * 0.08, dy: -box.height * 0.16)),
                    with: .radialGradient(Gradient(colors: [.white.opacity(0.42), .white.opacity(0)]),
                                          center: CGPoint(x: box.midX - box.width * 0.1, y: box.minY + box.height * 0.3),
                                          startRadius: 0, endRadius: max(box.width, box.height) * 0.45))
        var bloom = inside
        bloom.addFilter(.blur(radius: max(4, min(box.width, box.height) * 0.08)))
        for _ in 0..<3 {
            let w = box.width * random.range(0.18, 0.34), h = box.height * random.range(0.14, 0.3)
            let rect = CGRect(x: random.range(box.minX, box.maxX - w), y: random.range(box.midY - h / 2, box.maxY - h), width: w, height: h)
            bloom.fill(Path(ellipseIn: rect), with: .color(deep.opacity(random.range(0.08, 0.16))))
        }

        var rim = context
        rim.addFilter(.blur(radius: 1.1))
        rim.stroke(path, with: .color(deep.opacity(0.62 * opacity)), lineWidth: edge)

        let dots = Int(box.width * box.height / 190) * grain
        for _ in 0..<min(dots, 900) {
            let r = random.range(0.35, 1.3)
            let point = CGPoint(x: random.range(box.minX, box.maxX), y: random.range(box.minY, box.maxY))
            inside.fill(Shapes.circle(point, r), with: .color(deep.opacity(random.range(0.05, 0.17))))
        }
    }

    mutating func wash(_ path: Path, _ color: Color, deep: Color, opacity: Double = 0.9, edge: CGFloat = 2.2) {
        wash(path, .color(color), deep: deep, opacity: opacity, edge: edge)
    }

    func line(_ path: Path, _ color: Color, width: CGFloat = 1, opacity: Double = 0.5) {
        var layer = context
        layer.addFilter(.blur(radius: 0.35))
        layer.stroke(path, with: .color(color.opacity(opacity)), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }

    func dab(_ path: Path, _ color: Color, blur: CGFloat = 0.6, clip: Path? = nil) {
        var layer = context
        if let clip { layer.clip(to: clip) }
        if blur > 0 { layer.addFilter(.blur(radius: blur)) }
        layer.fill(path, with: .color(color))
    }

    mutating func fin(_ a: CGPoint, _ b: CGPoint, edge: [CGPoint], _ palette: FishPalette,
                      rays: Int = 9, scallop: CGFloat = 0.18, opacity: Double = 0.82) {
        let shape = Shapes.fan(a, b, edge: edge, scallop: scallop)
        wash(shape, palette.fin, deep: palette.finDeep, opacity: opacity, edge: 1.8)
        let root = Shapes.mid(a, b)
        let reach = edge.map { hypot($0.x - root.x, $0.y - root.y) }.max() ?? 1
        var tip = context
        tip.clip(to: shape)
        tip.fill(shape, with: .radialGradient(Gradient(colors: [palette.finDeep.opacity(0), palette.finDeep.opacity(0.08), palette.finDeep.opacity(0.34)]),
                                              center: root, startRadius: 0, endRadius: reach))
        line(Shapes.rays(a, b, edge: edge, count: rays), palette.finDeep, width: 0.9, opacity: 0.42)
        line(Shapes.rays(a, b, edge: edge, count: rays - 1, reach: 0.75), .white, width: 0.8, opacity: 0.35)
    }

    mutating func leafFin(_ base: CGPoint, _ tip: CGPoint, width: CGFloat, _ fill: Color, _ deep: Color, notch: CGFloat = 0) {
        wash(Shapes.leaf(base, tip, width: width, notch: notch), fill, deep: deep, opacity: 0.86, edge: 1.8)
        line(Shapes.veins(base, tip, width: width), notch > 0 ? deep : .white, width: 0.9, opacity: notch > 0 ? 0.3 : 0.55)
    }

    mutating func body(_ shape: Body, _ palette: FishPalette, shading: GraphicsContext.Shading? = nil, scales: Bool = true) {
        let path = shape.path
        wash(path, shading ?? .color(palette.body), deep: palette.deep, opacity: 0.95, edge: 2.6)
        let c = shape.center, l = shape.length, h = shape.height
        // Deeper pigment settles along the back; the belly stays pale like the atlas fish.
        dab(Path(ellipseIn: CGRect(x: c.x - l * 0.55, y: c.y - h * 0.78, width: l * 1.0, height: h * 0.62)),
            palette.deep.opacity(0.26), blur: h * 0.09, clip: path)
        dab(Path(ellipseIn: CGRect(x: c.x - l * 0.34, y: c.y + h * 0.04, width: l * 0.86, height: h * 0.64)),
            palette.belly.opacity(0.92), blur: h * 0.07, clip: path)
        if scales {
            var scale = context
            scale.clip(to: path)
            scale.addFilter(.blur(radius: 0.45))
            let step = max(h * 0.1, 11)
            var row = 0
            // Loose hand-placed scallops: jittered, varied in strength, fading toward the belly.
            for y in stride(from: c.y - h / 2, through: c.y + h * 0.16, by: step * 0.74) {
                let fade = 1 - max(0, (y - (c.y - h * 0.2)) / (h * 0.5))
                for x in stride(from: c.x - l * 0.44 + (row % 2 == 0 ? 0 : step / 2), through: c.x + l * 0.16, by: step) {
                    let center = CGPoint(x: x + random.range(-1.5, 1.5), y: y + random.range(-1.2, 1.2))
                    let radius = step * random.range(0.5, 0.62)
                    var arc = Path()
                    arc.addArc(center: center, radius: radius, startAngle: .degrees(random.range(60, 80)),
                               endAngle: .degrees(random.range(280, 300)), clockwise: false)
                    scale.stroke(arc, with: .color(palette.deep.opacity(random.range(0.1, 0.26) * fade)), lineWidth: random.range(0.8, 1.4))
                    var tint = Path()
                    tint.addArc(center: center.offset(radius * 0.25, 0), radius: radius * 0.72, startAngle: .degrees(100), endAngle: .degrees(260), clockwise: false)
                    scale.stroke(tint, with: .color(.white.opacity(random.range(0.12, 0.34) * fade)), lineWidth: 1.6)
                }
                row += 1
            }
        }
        var gill = Path()
        let gillX = c.x + l * 0.2
        gill.move(to: CGPoint(x: gillX, y: c.y - h * 0.3))
        gill.addQuadCurve(to: CGPoint(x: gillX - 2, y: c.y + h * 0.3), control: CGPoint(x: gillX + l * 0.05, y: c.y))
        line(gill, palette.deep, width: 1.5, opacity: 0.36)
    }

    func face(_ shape: Body, _ palette: FishPalette, sleepy: Bool = false) {
        let e = shape.eye, r = shape.eyeRadius
        dab(Path(ellipseIn: CGRect(x: e.x - r * 0.6, y: e.y + r * 1.15, width: r * 1.7, height: r * 0.9)), Color.blush.opacity(0.5), blur: 3)
        if sleepy {
            // A relaxed closed eye, the gentle counterpart of the peach fish's joyful crescents.
            var lid = Path()
            lid.move(to: e.offset(-r * 0.9, -r * 0.1))
            lid.addQuadCurve(to: e.offset(r * 0.9, -r * 0.1), control: e.offset(0, r * 0.75))
            line(lid, .eyeInk, width: 2.6, opacity: 0.9)
        } else {
            var eye = context
            eye.fill(Shapes.circle(e, r), with: .color(.eyeInk))
            eye.fill(Shapes.circle(e, r * 0.8), with: .radialGradient(Gradient(colors: [Color(hex: 0xF3BE63), Color(hex: 0xB86F24)]),
                                                                       center: e.offset(0, r * 0.3), startRadius: 0, endRadius: r))
            eye.fill(Shapes.circle(e.offset(r * 0.05, 0), r * 0.52), with: .color(.eyeInk))
            eye.fill(Shapes.circle(e.offset(-r * 0.3, -r * 0.34), r * 0.27), with: .color(.white))
            eye.fill(Shapes.circle(e.offset(r * 0.32, r * 0.3), r * 0.11), with: .color(.white.opacity(0.9)))
        }
        var mouth = Path()
        let m = shape.nose.offset(-shape.length * 0.05, shape.height * 0.02)
        mouth.move(to: m.offset(-7, -2))
        mouth.addQuadCurve(to: m.offset(1, -3), control: m.offset(-3, 4))
        line(mouth, .eyeInk, width: 1.6, opacity: 0.8)
    }

    // MARK: Fin builders

    /// Tail fanning left from the peduncle; `fork` pulls the middle in for a forked tail.
    mutating func tail(_ s: Body, _ p: FishPalette, reach: CGFloat, spread: CGFloat, lobes: Int = 5,
                       fork: CGFloat = 0, scallop: CGFloat = 0.22, rays: Int = 17) {
        let a = s.tailRoot.offset(10, -s.height * 0.13), b = s.tailRoot.offset(10, s.height * 0.13)
        let root = s.tailRoot.offset(8, 0)
        let edge = (0...lobes).map { i -> CGPoint in
            let t = CGFloat(i) / CGFloat(lobes)
            let angle = CGFloat.pi + spread / 2 - spread * t
            let r = reach * (1 - fork * (1 - abs(2 * t - 1)))
            return root.offset(cos(angle) * r, sin(angle) * r)
        }
        fin(a, b, edge: edge, p, rays: rays, scallop: scallop)
    }

    /// Dorsal (`up`) or ventral fin seated on the body between `t0` and `t1`, sweeping back by `lean`.
    mutating func sail(_ s: Body, _ p: FishPalette, from t0: CGFloat, to t1: CGFloat, height: CGFloat,
                       lean: CGFloat = 20, up: Bool = true, lobes: Int = 4, scallop: CGFloat = 0.22, rays: Int = 11) {
        let seat: (CGFloat) -> CGPoint = { up ? s.top($0).offset(0, 10) : s.bottom($0).offset(0, -10) }
        let a = seat(t0), b = seat(t1)
        let edge = (0...lobes).map { i -> CGPoint in
            let t = CGFloat(i) / CGFloat(lobes)
            let base = seat(t0 + (t1 - t0) * t)
            let lift = height * pow(sin(CGFloat.pi * (0.12 + 0.8 * t)), 0.7)
            return base.offset(-lean * (1 - t * 0.6), up ? -lift : lift)
        }
        fin(a, b, edge: edge, p, rays: rays, scallop: scallop)
    }

    /// Small side fin drawn over the body, pointing back and down.
    mutating func pectoral(_ s: Body, _ p: FishPalette, length: CGFloat = 52) {
        let root = CGPoint(x: s.center.x + s.length * 0.14, y: s.center.y + s.height * 0.12)
        let tip = root.offset(-length * 0.82, length * 0.5)
        let shape = Shapes.leaf(root, tip, width: length * 0.3)
        wash(shape, p.fin, deep: p.finDeep, opacity: 0.94, edge: 1.7)
        var rays = Path()
        for k in -2...2 {
            rays.move(to: root)
            rays.addQuadCurve(to: Shapes.lerp(root, tip, 0.88).offset(CGFloat(k) * 2.5, CGFloat(k) * 4.5),
                              control: Shapes.lerp(root, tip, 0.5).offset(CGFloat(k) * 1.5, CGFloat(k) * 3))
        }
        line(rays, p.finDeep, width: 0.9, opacity: 0.45)
    }

    mutating func sparkle(_ center: CGPoint, _ radius: CGFloat, _ color: Color = .white) {
        dab(Shapes.star(center, radius), color.opacity(0.95), blur: 0.3)
    }

    mutating func paint(_ species: FishSpecies) {
        switch species {
        case .sakura: sakura()
        case .lemon: lemon()
        case .strawberry: strawberry()
        case .pebble: pebble()
        case .cloud: cloud()
        case .bubble: bubble()
        case .maple: maple()
        case .ribbon: ribbon()
        case .lantern: lantern()
        case .aurora: aurora()
        default: break
        }
    }

    // MARK: Species

    private mutating func sakura() {
        let p = FishPalette(0xF1AFC0, 0xC4647F, 0xFFF4EC, 0xF6C3D1, 0xD47F99)
        let s = Body(center: CGPoint(x: 305, y: 205), length: 236, height: 152)
        leafFin(s.tailRoot, CGPoint(x: 72, y: 96), width: 60, p.fin, p.finDeep, notch: 20)
        leafFin(s.tailRoot, CGPoint(x: 72, y: 314), width: 60, p.fin, p.finDeep, notch: 20)
        leafFin(s.tailRoot, CGPoint(x: 58, y: 205), width: 40, p.fin, p.finDeep, notch: 16)
        leafFin(s.top(0.48).offset(0, 12), CGPoint(x: 236, y: 48), width: 48, p.fin, p.finDeep, notch: 16)
        leafFin(s.top(0.7).offset(0, 12), CGPoint(x: 300, y: 76), width: 30, p.fin, p.finDeep, notch: 11)
        leafFin(s.bottom(0.52).offset(0, -10), CGPoint(x: 262, y: 344), width: 32, p.fin, p.finDeep, notch: 12)
        body(s, p)
        for (x, y, r) in [(250.0, 190.0, 15.0), (292, 234, 12), (218, 232, 10), (282, 168, 8), (200, 196, 7)] {
            blossom(CGPoint(x: x, y: y), r, clip: s.path)
        }
        face(s, p)
        leafFin(CGPoint(x: 342, y: 230), CGPoint(x: 300, y: 272), width: 20, p.fin, p.finDeep, notch: 8)
    }

    private func blossom(_ center: CGPoint, _ r: CGFloat, clip: Path) {
        var petals = Path()
        for i in 0..<5 {
            let a = CGFloat(i) * 2 * .pi / 5 - .pi / 2
            let c = center.offset(cos(a) * r * 0.62, sin(a) * r * 0.62)
            petals.addEllipse(in: CGRect(x: c.x - r * 0.46, y: c.y - r * 0.46, width: r * 0.92, height: r * 0.92))
        }
        dab(petals, Color(hex: 0xFFF1F4, opacity: 0.92), blur: 0.4, clip: clip)
        dab(Shapes.circle(center, r * 0.24), Color(hex: 0xE0809C), blur: 0.4, clip: clip)
    }

    private mutating func lemon() {
        let p = FishPalette(0xF3CE55, 0xC08F14, 0xFFF6D2, 0xEDE39A, 0xA7A93F)
        let s = Body(center: CGPoint(x: 300, y: 210), length: 222, height: 184, pinch: 0.12)
        tail(s, p, reach: 150, spread: 1.75, lobes: 5, scallop: 0.32, rays: 19)
        leafFin(s.top(0.6).offset(0, 14), CGPoint(x: 262, y: 34), width: 32, Color(hex: 0x9CC46A), Color(hex: 0x5E8C3A))
        sail(s, p, from: 0.26, to: 0.52, height: 46, lean: 26, lobes: 3)
        sail(s, p, from: 0.4, to: 0.62, height: 44, lean: 22, up: false, lobes: 2, rays: 7)
        body(s, p)
        let slice = CGPoint(x: 258, y: 210)
        dab(Shapes.circle(slice, 46), Color(hex: 0xFBF0B8, opacity: 0.92), blur: 1, clip: s.path)
        line(Shapes.circle(slice, 46), Color(hex: 0xD8A728), width: 3.2, opacity: 0.6)
        var segments = Path()
        for i in 0..<8 {
            let a = CGFloat(i) * .pi / 4
            segments.move(to: slice)
            segments.addLine(to: slice.offset(cos(a) * 39, sin(a) * 39))
        }
        line(segments, .white, width: 2.4, opacity: 0.95)
        line(Shapes.circle(slice, 39), .white, width: 1.8, opacity: 0.85)
        face(s, p)
        pectoral(s, p)
    }

    private mutating func strawberry() {
        let p = FishPalette(0xE65F69, 0xA42F40, 0xFFE3D6, 0xF29CA3, 0xC04F63)
        let s = Body(center: CGPoint(x: 295, y: 222), length: 218, height: 196, belly: 1.02, pinch: 0.12)
        tail(s, p, reach: 130, spread: 1.6, lobes: 4, scallop: 0.34, rays: 15)
        sail(s, p, from: 0.4, to: 0.62, height: 44, lean: 20, up: false, lobes: 2, rays: 7)
        body(s, p)
        var inside = context
        inside.clip(to: s.path)
        var row = 0
        for y in stride(from: 136.0, through: 306, by: 23) {
            for x in stride(from: 196.0 + (row % 2 == 0 ? 0 : 12), through: 360, by: 25) where hypot(x - s.eye.x, y - s.eye.y) > 30 {
                var seed = Path()
                seed.addEllipse(in: CGRect(x: x - 2.8, y: y - 4.4, width: 5.6, height: 8.8))
                inside.fill(seed, with: .color(Color(hex: 0xFFE9A8, opacity: 0.95)))
                inside.stroke(seed, with: .color(Color(hex: 0xC98A2E, opacity: 0.4)), lineWidth: 0.8)
            }
            row += 1
        }
        let crown = CGPoint(x: 288, y: 128)
        for (angle, length) in [(-160.0, 60.0), (-128, 72), (-96, 78), (-64, 70), (-30, 58)] {
            let a: CGFloat = CGFloat(angle) * .pi / 180
            let reach = CGFloat(length)
            leafFin(crown, crown.offset(cos(a) * reach, sin(a) * reach), width: 15, Color(hex: 0x86B86A), Color(hex: 0x4F8A3F))
        }
        dab(Shapes.circle(crown.offset(0, -2), 9), Color(hex: 0x6E9F52), blur: 0.5)
        face(s, p)
        pectoral(s, p, length: 44)
    }

    private mutating func pebble() {
        let p = FishPalette(0xA7A095, 0x645F57, 0xEDE6D8, 0xBDB5A8, 0x7E766B)
        let s = Body(center: CGPoint(x: 300, y: 220), length: 244, height: 166, belly: 1.05, pinch: 0.14)
        tail(s, p, reach: 124, spread: 1.5, lobes: 3, scallop: 0.45, rays: 13)
        sail(s, p, from: 0.26, to: 0.66, height: 46, lean: 24, lobes: 3, scallop: 0.35, rays: 12)
        sail(s, p, from: 0.4, to: 0.62, height: 38, lean: 20, up: false, lobes: 2, rays: 7)
        body(s, p)
        for _ in 0..<60 {
            let point = CGPoint(x: random.range(180, 380), y: random.range(146, 300))
            let dark = random.next() < 0.6
            dab(Shapes.circle(point, random.range(1.6, 4.6)), dark ? p.deep.opacity(0.42) : Color.white.opacity(0.75), blur: 0.5, clip: s.path)
        }
        dab(Path(ellipseIn: CGRect(x: 246, y: 134, width: 70, height: 22)), Color(hex: 0x93B066, opacity: 0.75), blur: 3, clip: s.path)
        face(s, p, sleepy: true)
        pectoral(s, p)
    }

    private mutating func cloud() {
        let p = FishPalette(0xE0ECF8, 0x5B89B2, 0xFFFFFF, 0xD3E3F3, 0x6793BA)
        let s = Body(center: CGPoint(x: 305, y: 206), length: 228, height: 158)
        let tail = Shapes.cloud([(CGPoint(x: 172, y: 206), 30), (CGPoint(x: 132, y: 150), 38), (CGPoint(x: 112, y: 206), 38),
                                 (CGPoint(x: 132, y: 262), 38), (CGPoint(x: 80, y: 126), 30), (CGPoint(x: 70, y: 206), 28), (CGPoint(x: 80, y: 286), 30)])
        wash(tail, p.fin, deep: p.finDeep, opacity: 0.88, edge: 2)
        wash(Shapes.cloud([(CGPoint(x: 240, y: 118), 28), (CGPoint(x: 280, y: 94), 34), (CGPoint(x: 322, y: 114), 26), (CGPoint(x: 206, y: 132), 20)]),
             p.fin, deep: p.finDeep, opacity: 0.88, edge: 2)
        wash(Shapes.cloud([(CGPoint(x: 268, y: 300), 20), (CGPoint(x: 296, y: 312), 17)]), p.fin, deep: p.finDeep, opacity: 0.88, edge: 1.8)
        body(s, p, scales: false)
        var swirl = Path()
        swirl.move(to: CGPoint(x: 214, y: 196))
        swirl.addCurve(to: CGPoint(x: 276, y: 188), control1: CGPoint(x: 230, y: 168), control2: CGPoint(x: 266, y: 164))
        swirl.addCurve(to: CGPoint(x: 252, y: 206), control1: CGPoint(x: 284, y: 204), control2: CGPoint(x: 262, y: 216))
        line(swirl, p.deep, width: 2, opacity: 0.5)
        face(s, p)
        wash(Shapes.cloud([(CGPoint(x: 330, y: 250), 15), (CGPoint(x: 312, y: 264), 13)]), p.fin, deep: p.finDeep, opacity: 0.92, edge: 1.6)
    }

    private mutating func bubble() {
        let p = FishPalette(0x78C8BE, 0x35827C, 0xEEFAF3, 0xA2DCD4, 0x42968F)
        let s = Body(center: CGPoint(x: 290, y: 214), length: 222, height: 160)
        tail(s, p, reach: 160, spread: 1.8, lobes: 6, fork: 0.42, scallop: 0.12, rays: 21)
        sail(s, p, from: 0.28, to: 0.66, height: 82, lean: 40, lobes: 4, rays: 13)
        sail(s, p, from: 0.38, to: 0.6, height: 46, lean: 26, up: false, lobes: 2, rays: 7)
        body(s, p)
        for (x, y, r) in [(232.0, 202.0, 14.0), (266, 236, 10), (254, 172, 8), (208, 238, 9), (292, 198, 6)] {
            bubbleDot(CGPoint(x: x, y: y), r, tint: p.deep, clip: s.path)
        }
        face(s, p)
        pectoral(s, p)
        for (x, y, r) in [(428.0, 178.0, 8.0), (452, 144, 11), (440, 100, 15)] {
            bubbleDot(CGPoint(x: x, y: y), r, tint: p.deep, clip: nil)
        }
    }

    private func bubbleDot(_ center: CGPoint, _ r: CGFloat, tint: Color, clip: Path?) {
        var layer = context
        if let clip { layer.clip(to: clip) }
        layer.fill(Shapes.circle(center, r), with: .radialGradient(Gradient(colors: [.white.opacity(0.2), Color(hex: 0xE9C8F0, opacity: 0.4)]),
                                                                    center: center, startRadius: 0, endRadius: r))
        layer.stroke(Shapes.circle(center, r), with: .color(tint.opacity(0.6)), lineWidth: 1.3)
        var shine = Path()
        shine.addArc(center: center, radius: r * 0.68, startAngle: .degrees(200), endAngle: .degrees(260), clockwise: false)
        layer.stroke(shine, with: .color(.white.opacity(0.95)), style: StrokeStyle(lineWidth: max(1.2, r * 0.22), lineCap: .round))
    }

    private mutating func maple() {
        let p = FishPalette(0xD8653A, 0x983820, 0xFBE2C6, 0xE4893F, 0xA9491F)
        let s = Body(center: CGPoint(x: 318, y: 208), length: 246, height: 128)
        let leaf = Color(hex: 0xE08A3C), leafDeep = Color(hex: 0xA2451C)
        mapleLeaf(CGPoint(x: 172, y: 208), 104, .pi, leaf, leafDeep)
        mapleLeaf(CGPoint(x: 284, y: 132), 64, -.pi * 0.62, leaf, leafDeep)
        mapleLeaf(CGPoint(x: 290, y: 276), 40, .pi * 0.62, leaf, leafDeep)
        body(s, p)
        for _ in 0..<24 {
            dab(Shapes.circle(CGPoint(x: random.range(210, 360), y: random.range(160, 204)), random.range(1.2, 2.8)), Color(hex: 0xF6C45A, opacity: 0.9), blur: 0.3, clip: s.path)
        }
        face(s, p)
        mapleLeaf(CGPoint(x: 336, y: 244), 26, .pi * 0.8, leaf, leafDeep)
    }

    private mutating func mapleLeaf(_ center: CGPoint, _ radius: CGFloat, _ angle: CGFloat, _ fill: Color, _ deep: Color) {
        wash(Shapes.maple(center: center, radius: radius, angle: angle), fill, deep: deep, opacity: 0.9, edge: 1.8)
        var veins = Path()
        for (offset, reach) in [(0.0, 0.85), (0.78, 0.7), (-0.78, 0.7), (1.55, 0.45), (-1.55, 0.45)] {
            let a = angle + CGFloat(offset)
            veins.move(to: center)
            veins.addLine(to: center.offset(cos(a) * radius * CGFloat(reach), sin(a) * radius * CGFloat(reach)))
        }
        line(veins, .white, width: max(0.9, radius / 60), opacity: 0.6)
    }

    private mutating func ribbon() {
        let p = FishPalette(0xF4E1BC, 0xA07A45, 0xFFF8EA, 0x80B8B4, 0x377675)
        let s = Body(center: CGPoint(x: 318, y: 204), length: 286, height: 112, pinch: 0.16)
        let knot = s.tailRoot.offset(4, 0)
        for side in [-1.0, 1.0] {
            let d = CGFloat(side)
            var streamer = Path()
            streamer.move(to: knot.offset(0, -5 * d))
            streamer.addCurve(to: CGPoint(x: 26, y: 204 + 128 * d), control1: knot.offset(-50, 70 * d), control2: CGPoint(x: 90, y: 204 + 150 * d))
            streamer.addLine(to: CGPoint(x: 44, y: 204 + 98 * d))
            streamer.addCurve(to: knot.offset(0, 5 * d), control1: CGPoint(x: 96, y: 204 + 108 * d), control2: knot.offset(-30, 40 * d))
            streamer.closeSubpath()
            wash(streamer, p.fin, deep: p.finDeep, opacity: 0.88, edge: 1.8)
        }
        sail(s, p, from: 0.14, to: 0.74, height: 44, lean: 18, lobes: 6, scallop: 0.3, rays: 18)
        sail(s, p, from: 0.3, to: 0.56, height: 34, lean: 18, up: false, lobes: 2, rays: 7)
        body(s, p, scales: false)
        for x in [218.0, 268, 318] {
            var band = Path()
            band.move(to: CGPoint(x: x + 6, y: 140))
            band.addQuadCurve(to: CGPoint(x: x + 6, y: 268), control: CGPoint(x: x - 12, y: 204))
            band.addLine(to: CGPoint(x: x + 24, y: 268))
            band.addQuadCurve(to: CGPoint(x: x + 24, y: 140), control: CGPoint(x: x + 6, y: 204))
            band.closeSubpath()
            dab(band, p.fin.opacity(0.88), blur: 1.2, clip: s.path)
        }
        bow(at: knot)
        face(s, p)
        pectoral(s, p, length: 38)
    }

    private mutating func bow(at knot: CGPoint) {
        let red = Color(hex: 0xE27A7A), redDeep = Color(hex: 0xA9454A)
        for side in [-1.0, 1.0] {
            var loop = Path()
            loop.move(to: knot)
            loop.addCurve(to: knot, control1: knot.offset(-36, CGFloat(side) * 46), control2: knot.offset(14, CGFloat(side) * 52))
            wash(loop, red, deep: redDeep, opacity: 0.94, edge: 1.6)
        }
        wash(Shapes.circle(knot, 8), red, deep: redDeep, opacity: 1, edge: 1.3)
    }

    private mutating func lantern() {
        let p = FishPalette(0x3F6E7A, 0x1C3A44, 0xD6E8E0, 0x6A9AA1, 0x2B5760)
        let s = Body(center: CGPoint(x: 280, y: 240), length: 226, height: 170, belly: 1.04)
        tail(s, p, reach: 126, spread: 1.55, lobes: 4, scallop: 0.34, rays: 15)
        sail(s, p, from: 0.26, to: 0.58, height: 48, lean: 22, lobes: 4, scallop: 0.12, rays: 10)
        sail(s, p, from: 0.4, to: 0.62, height: 40, lean: 20, up: false, lobes: 2, rays: 7)
        body(s, p)
        for (x, y) in [(206.0, 268.0), (230, 279), (254, 285), (278, 287), (302, 283)] {
            dab(Shapes.circle(CGPoint(x: x, y: y), 4.8), Color(hex: 0xFFE7A0, opacity: 0.95), blur: 1.2, clip: s.path)
        }
        var stalk = Path()
        stalk.move(to: CGPoint(x: 350, y: 172))
        stalk.addCurve(to: CGPoint(x: 438, y: 76), control1: CGPoint(x: 356, y: 96), control2: CGPoint(x: 412, y: 58))
        line(stalk, p.deep, width: 3.2, opacity: 0.8)
        let bulb = CGPoint(x: 442, y: 86)
        dab(Shapes.circle(bulb, 40), Color(hex: 0xFFE08A, opacity: 0.6), blur: 12)
        wash(Shapes.circle(bulb, 18), .radialGradient(Gradient(colors: [Color(hex: 0xFFF6CF), Color(hex: 0xF4B940)]), center: bulb.offset(-4, -4), startRadius: 0, endRadius: 19),
             deep: Color(hex: 0xC98A20), opacity: 1, edge: 1.5)
        sparkle(bulb.offset(-6, -6), 7)
        face(s, p)
        pectoral(s, p)
    }

    private mutating func aurora() {
        let p = FishPalette(0xA8DCCB, 0x5F6AA8, 0xF8F5FF, 0xB9C6F0, 0x6F70B4)
        let s = Body(center: CGPoint(x: 330, y: 204), length: 224, height: 116)
        let finShade = GraphicsContext.Shading.linearGradient(Gradient(colors: [Color(hex: 0xE6A2D0), Color(hex: 0x9DB4EC), Color(hex: 0x9EDFC9)]),
                                                              startPoint: CGPoint(x: 20, y: 200), endPoint: CGPoint(x: 380, y: 200))
        let root = s.tailRoot.offset(8, 0)
        for (tip, control) in [(CGPoint(x: 40, y: 60), CGPoint(x: 150, y: 90)), (CGPoint(x: 16, y: 206), CGPoint(x: 110, y: 176)), (CGPoint(x: 44, y: 344), CGPoint(x: 150, y: 316))] {
            var veil = Path()
            veil.move(to: root.offset(0, -16))
            veil.addQuadCurve(to: tip, control: control.offset(-10, -30))
            veil.addQuadCurve(to: root.offset(0, 16), control: control.offset(34, 30))
            veil.closeSubpath()
            wash(veil, finShade, deep: p.finDeep, opacity: 0.76, edge: 1.5)
            var rays = Path()
            for k in -2...2 {
                rays.move(to: root)
                rays.addQuadCurve(to: Shapes.lerp(root, tip, 0.9).offset(0, CGFloat(k) * 7), control: control.offset(CGFloat(k) * 5, CGFloat(k) * 6))
            }
            line(rays, .white, width: 1, opacity: 0.5)
        }
        var dorsal = Path()
        dorsal.move(to: s.top(0.28).offset(0, 10))
        dorsal.addCurve(to: CGPoint(x: 150, y: 34), control1: CGPoint(x: 250, y: 84), control2: CGPoint(x: 196, y: 36))
        dorsal.addCurve(to: s.top(0.7).offset(0, 10), control1: CGPoint(x: 214, y: 90), control2: CGPoint(x: 316, y: 110))
        dorsal.closeSubpath()
        wash(dorsal, finShade, deep: p.finDeep, opacity: 0.76, edge: 1.5)
        var pelvic = Path()
        pelvic.move(to: s.bottom(0.42).offset(0, -8))
        pelvic.addCurve(to: CGPoint(x: 196, y: 352), control1: CGPoint(x: 286, y: 312), control2: CGPoint(x: 240, y: 352))
        pelvic.addCurve(to: s.bottom(0.64).offset(0, -8), control1: CGPoint(x: 262, y: 330), control2: CGPoint(x: 318, y: 296))
        pelvic.closeSubpath()
        wash(pelvic, finShade, deep: p.finDeep, opacity: 0.76, edge: 1.5)
        let bodyShade = GraphicsContext.Shading.linearGradient(Gradient(colors: [Color(hex: 0xE2A4D0), Color(hex: 0x9AB7EA), Color(hex: 0x9EDCC7)]),
                                                               startPoint: CGPoint(x: 218, y: 200), endPoint: CGPoint(x: 430, y: 200))
        body(s, p, shading: bodyShade)
        face(s, p)
        pectoral(s, p, length: 40)
        for (x, y, r) in [(262.0, 180.0, 6.5), (296, 200, 5), (240, 210, 4.5), (110, 120, 7), (92, 290, 6), (196, 70, 6), (226, 330, 5), (70, 200, 5)] {
            sparkle(CGPoint(x: x, y: y), r, y > 150 && y < 250 && x > 220 ? .white : Color(hex: 0xFFF3C4))
        }
    }
}
