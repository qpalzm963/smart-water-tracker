import SwiftUI
import PondCore

/// The background stays locked. Registered pose paintings are composited only
/// around the cat; the rod, line, float, fish and water remain independent layers.
struct FishingSceneLayer: View {
    @ObservedObject var store: PondStore
    let reduceMotion: Bool

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || !store.pondVisible || store.caught != nil)) { timeline in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                let motion = store.reelStartedAt.map {
                    FishingMotion(elapsed: store.caught != nil || reduceMotion ? FishingMotion.duration : timeline.date.timeIntervalSince($0))
                }
                ZStack {
                    sceneImage(Artwork.pond, size: geometry.size)
                    poses(size: geometry.size, motion: motion)
                        .mask {
                            RoundedRectangle(cornerRadius: geometry.size.width * 0.03)
                                .frame(width: geometry.size.width * 0.365, height: geometry.size.height * 0.47)
                                .position(x: geometry.size.width * 0.2775, y: geometry.size.height * 0.46)
                                .blur(radius: geometry.size.width * 0.005)
                        }
                    if motion == nil && !reduceMotion {
                        sceneImage(Artwork.blink, size: geometry.size)
                            .mask { Ellipse().frame(width: geometry.size.width * 0.095, height: geometry.size.height * 0.055)
                                .position(x: geometry.size.width * 0.325, y: geometry.size.height * 0.393).blur(radius: 1.3) }
                            .opacity(time.truncatingRemainder(dividingBy: 5.3) < 0.18 ? 1 : 0)
                    }
                    Canvas { context, size in
                        FishingPainter.draw(context: &context, size: size, time: time, motion: motion, ready: store.data.tickets > 0, still: reduceMotion)
                    }
                    // Put the front of the gripping paw over the handle, avoiding a
                    // rod painted across the cat's fingers.
                    let grip = motion?.grip ?? CGPoint(x: 0.325, y: 0.516)
                    poses(size: geometry.size, motion: motion)
                        .mask { Ellipse().frame(width: geometry.size.width * 0.028, height: geometry.size.height * 0.032)
                            .position(x: geometry.size.width * (grip.x - 0.009), y: geometry.size.height * (grip.y + 0.007)) }
                    if let motion, let fish = store.pendingCatch, motion.fishOpacity > 0 {
                        ZStack {
                            // A soft paper-light underlay keeps watercolor fish
                            // readable over dark trees without a rectangular matte.
                            Ellipse()
                                .fill(RadialGradient(stops: [.init(color: PondStyle.cream.opacity(0.96), location: 0),
                                                             .init(color: PondStyle.cream.opacity(0.88), location: 0.55),
                                                             .init(color: PondStyle.cream.opacity(0), location: 1)],
                                                     center: .center, startRadius: 0, endRadius: geometry.size.width * 0.056))
                                .frame(width: geometry.size.width * 0.11, height: geometry.size.width * 0.074)
                                .blur(radius: geometry.size.width * 0.004)
                            FishDrawing(species: fish.species)
                        }
                            .frame(width: geometry.size.width * 0.115, height: geometry.size.width * 0.10)
                            .scaleEffect(x: -1, y: 1)
                            .rotationEffect(.degrees(motion.fishAngle))
                            .position(x: motion.fishCenter.x * geometry.size.width, y: motion.fishCenter.y * geometry.size.height)
                            .opacity(motion.fishOpacity)
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .compositingGroup()
            }
        }.accessibilityHidden(true)
    }

    private func sceneImage(_ image: NSImage, size: CGSize) -> some View {
        Image(nsImage: image).resizable().scaledToFill().frame(width: size.width, height: size.height).clipped()
    }
    private func poses(size: CGSize, motion: FishingMotion?) -> some View {
        ZStack {
            sceneImage(Artwork.pond, size: size)
            if let motion {
                sceneImage(Artwork.pull, size: size).opacity(motion.pullBlend)
                sceneImage(Artwork.lift, size: size).opacity(motion.liftBlend)
                sceneImage(Artwork.happy, size: size).opacity(motion.happyBlend)
            }
        }
    }
}

private enum FishingPainter {
    static func draw(context: inout GraphicsContext, size: CGSize, time: Double, motion: FishingMotion?, ready: Bool, still: Bool) {
        let w = size.width, h = size.height
        func pixel(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * w, y: p.y * h) }
        let bob = still ? 0 : sin(time * (ready ? 4.5 : 1.8)) * (ready ? 0.004 : 0.002) * h
        let grip = pixel(motion?.grip ?? CGPoint(x: 0.325, y: 0.516))
        var tip = pixel(motion?.tip ?? CGPoint(x: 0.64, y: 0.325))
        let bend = pixel(motion?.bend ?? CGPoint(x: 0.47, y: 0.335))
        if let motion, motion.elapsed > 1, !still {
            let release = motion.elapsed - 1
            tip.y += sin(release * 23) * exp(-release * 6) * h * 0.018
        } else if motion == nil { tip.y += bob * 0.25 }
        var float = CGPoint(x: w * 0.70, y: h * 0.73 + (motion == nil ? bob : 0))
        if let motion, motion.elapsed < 0.4, !still {
            float.y += sin(motion.elapsed / 0.4 * .pi) * h * 0.021
        }

        drawRipples(context: &context, size: size, time: time, motion: motion)
        if let motion, !still { drawSplash(context: &context, size: size, progress: motion.splashProgress) }
        drawRod(context: &context, grip: grip, control: bend, tip: tip, scale: w)

        var end = float
        if let motion, motion.elapsed >= 1 {
            let angle: Double = motion.fishAngle * Double.pi / 180
            let center = pixel(motion.fishCenter)
            let dx = CGFloat(Darwin.cos(angle)), dy = CGFloat(Darwin.sin(angle))
            end = CGPoint(x: center.x - w * 0.048 * dx, y: center.y - w * 0.048 * dy)
        }
        let slack = motion == nil ? h * 0.038 : (motion?.phase == .celebrate ? h * 0.013 : 0)
        var line = Path()
        line.move(to: tip)
        line.addQuadCurve(to: end, control: CGPoint(x: (tip.x + end.x) / 2 + slack * 0.25, y: (tip.y + end.y) / 2 + slack))
        context.stroke(line, with: .color(Color(red: 0.20, green: 0.30, blue: 0.26).opacity(0.30)), lineWidth: max(1.2, w * 0.003))
        context.stroke(line, with: .color(PondStyle.cream.opacity(0.92)), lineWidth: max(0.6, w * 0.0014))
        var bobberContext = context
        bobberContext.opacity = motion?.bobberOpacity ?? 1
        drawBobber(context: &bobberContext, at: float, scale: w)

        for i in 0..<5 {
            let x = w * (0.48 + Double(i) * 0.1) + sin(time * 0.3 + Double(i)) * w * 0.015
            let y = h * (0.22 + Double(i % 3) * 0.11) + cos(time * 0.4 + Double(i)) * h * 0.012
            context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.6, height: 1.6)), with: .color(PondStyle.cream.opacity(0.55)))
        }
    }

    private static func drawRod(context: inout GraphicsContext, grip: CGPoint, control: CGPoint, tip: CGPoint, scale w: Double) {
        func point(_ t: Double) -> CGPoint {
            CGPoint(x: (1-t)*(1-t)*grip.x + 2*(1-t)*t*control.x + t*t*tip.x,
                    y: (1-t)*(1-t)*grip.y + 2*(1-t)*t*control.y + t*t*tip.y)
        }
        func normal(_ t: Double) -> CGVector {
            let dx = 2*(1-t)*(control.x-grip.x) + 2*t*(tip.x-control.x)
            let dy = 2*(1-t)*(control.y-grip.y) + 2*t*(tip.y-control.y)
            let length = max(1, hypot(dx, dy))
            return CGVector(dx: -dy/length, dy: dx/length)
        }
        let dark = Color(red: 0.28, green: 0.18, blue: 0.10)
        let honey = Color(red: 0.65, green: 0.43, blue: 0.21)
        let light = Color(red: 0.91, green: 0.72, blue: 0.42)
        // Individually tapered segments keep the tip delicate even at small sizes.
        for i in 0..<64 {
            let t = Double(i) / 64, next = Double(i + 1) / 64
            let width = w * (0.010 * (1-t) + 0.0015)
            var stroke = Path(); stroke.move(to: point(t)); stroke.addLine(to: point(next))
            context.stroke(stroke, with: .color(dark), style: StrokeStyle(lineWidth: width, lineCap: .round))
            context.stroke(stroke, with: .color(honey), style: StrokeStyle(lineWidth: width * 0.72, lineCap: .round))
            let a = point(t), b = point(next), n = normal(t)
            var glint = Path(); glint.move(to: CGPoint(x: a.x-n.dx*width*0.20, y: a.y-n.dy*width*0.20))
            glint.addLine(to: CGPoint(x: b.x-n.dx*width*0.20, y: b.y-n.dy*width*0.20))
            context.stroke(glint, with: .color(light.opacity(0.75 + sin(t * 70) * 0.15)), lineWidth: width * 0.18)
        }
        for t in [0.14, 0.34, 0.54, 0.72, 0.88] {
            let p = point(t), n = normal(t), width = w * (0.010 * (1-t) + 0.0015)
            var joint = Path(); joint.move(to: CGPoint(x: p.x-n.dx*width*0.64, y: p.y-n.dy*width*0.64))
            joint.addLine(to: CGPoint(x: p.x+n.dx*width*0.64, y: p.y+n.dy*width*0.64))
            context.stroke(joint, with: .color(dark.opacity(0.85)), style: StrokeStyle(lineWidth: max(1, w*0.0035), lineCap: .round))
            context.stroke(joint, with: .color(light.opacity(0.8)), lineWidth: max(0.45, w*0.0012))
        }
        // Wrapped grip extends behind the front paw. A small brass butt cap and
        // thread cross-wraps give the pole a crafted, rather than plastic, finish.
        let n = normal(0), tangent = CGVector(dx: n.dy, dy: -n.dx)
        let butt = CGPoint(x: grip.x - tangent.dx*w*0.061, y: grip.y - tangent.dy*w*0.061)
        var handle = Path(); handle.move(to: butt); handle.addLine(to: grip)
        context.stroke(handle, with: .color(dark), style: StrokeStyle(lineWidth: w*0.018, lineCap: .round))
        context.stroke(handle, with: .color(Color(red: 0.55, green: 0.34, blue: 0.22)), style: StrokeStyle(lineWidth: w*0.013, lineCap: .round))
        for i in 0..<9 {
            let distance = w * (0.005 + Double(i)*0.006)
            let p = CGPoint(x: butt.x+tangent.dx*distance, y: butt.y+tangent.dy*distance)
            var wrap = Path(); wrap.move(to: CGPoint(x: p.x-n.dx*w*0.006, y: p.y-n.dy*w*0.006))
            wrap.addLine(to: CGPoint(x: p.x+n.dx*w*0.006+tangent.dx*w*0.003, y: p.y+n.dy*w*0.006+tangent.dy*w*0.003))
            context.stroke(wrap, with: .color(PondStyle.cream.opacity(0.48)), lineWidth: max(0.5, w*0.0015))
        }
        context.fill(Path(ellipseIn: CGRect(x: butt.x-w*0.007, y: butt.y-w*0.007, width: w*0.014, height: w*0.014)), with: .color(honey))
        context.stroke(Path(ellipseIn: CGRect(x: tip.x-w*0.003, y: tip.y-w*0.003, width: w*0.006, height: w*0.006)), with: .color(light), lineWidth: max(0.6,w*0.0015))
    }

    private static func drawBobber(context: inout GraphicsContext, at p: CGPoint, scale w: Double) {
        let r = w * 0.009
        let rect = CGRect(x: p.x-r, y: p.y-r*1.4, width: r*2, height: r*2.6)
        context.fill(Path(ellipseIn: rect), with: .linearGradient(Gradient(colors: [Color(red: 0.94, green: 0.52, blue: 0.34), PondStyle.coral]), startPoint: CGPoint(x: p.x-r, y: p.y-r), endPoint: CGPoint(x: p.x+r, y: p.y+r)))
        context.fill(Path(ellipseIn: CGRect(x: p.x-r, y: p.y, width: r*2, height: r*1.2)), with: .color(PondStyle.cream))
        context.stroke(Path(ellipseIn: rect), with: .color(PondStyle.ink.opacity(0.55)), lineWidth: 0.65)
        var stem = Path(); stem.move(to: CGPoint(x: p.x, y: p.y-r*1.2)); stem.addLine(to: CGPoint(x: p.x, y: p.y-r*2.4))
        context.stroke(stem, with: .color(PondStyle.ink), style: StrokeStyle(lineWidth: max(0.8, w*0.002), lineCap: .round))
        context.fill(Path(ellipseIn: CGRect(x: p.x-r*0.45, y: p.y-r*0.95, width: r*0.5, height: r*0.8)), with: .color(.white.opacity(0.65)))
    }

    private static func drawRipples(context: inout GraphicsContext, size: CGSize, time: Double, motion: FishingMotion?) {
        for i in 0..<3 {
            let phase = (time * 0.28 + Double(i) / 3).truncatingRemainder(dividingBy: 1)
            let width = size.width * (0.035 + phase * 0.13)
            let rect = CGRect(x: size.width*0.70-width/2, y: size.height*0.744-width*0.14, width: width, height: width*0.28)
            context.stroke(Path(ellipseIn: rect), with: .color(.white.opacity((1-phase)*0.48)), lineWidth: max(0.7,size.width*0.002))
        }
    }

    private static func drawSplash(context: inout GraphicsContext, size: CGSize, progress p: Double) {
        guard p > 0, p < 1 else { return }
        let origin = CGPoint(x: size.width*0.70, y: size.height*0.744)
        for i in 0..<11 {
            let angle = Double(i) / 10 * .pi
            let spread = (Double(i % 3)*0.018 + 0.055) * size.width
            let dx = cos(angle)*spread*p
            let dy = -sin(angle)*size.height*0.19*p + size.height*0.16*p*p
            let radius = size.width*(i.isMultiple(of: 3) ? 0.0045 : 0.0025)*(1-p*0.5)
            context.fill(Path(ellipseIn: CGRect(x: origin.x+dx-radius, y: origin.y+dy-radius, width: radius*2, height: radius*3)), with: .color(PondStyle.cream.opacity((1-p)*0.95)))
        }
        let width = size.width*(0.05+p*0.20)
        context.stroke(Path(ellipseIn: CGRect(x: origin.x-width/2, y: origin.y-width*0.12, width: width, height: width*0.24)), with: .color(.white.opacity((1-p)*0.85)), lineWidth: 1.5)
    }
}
