import SwiftUI
import PondCore

enum WeatherPainter {
    static func umbrella(context: inout GraphicsContext, size: CGSize) {
        let w = size.width, h = size.height
        func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * w, y: y * h) }
        let wood = Color(red: 0.40, green: 0.29, blue: 0.18)
        // The pole is anchored beside the cat, clear of its paws and the cup.
        var pole = Path(); pole.move(to: p(0.145, 0.25)); pole.addLine(to: p(0.125, 0.72))
        context.stroke(pole, with: .color(wood), style: StrokeStyle(lineWidth: w * 0.009, lineCap: .round))
        context.stroke(pole, with: .color(PondStyle.cream.opacity(0.45)), lineWidth: w * 0.002)
        context.fill(Path(ellipseIn: CGRect(x: w * 0.105, y: h * 0.707, width: w * 0.044, height: h * 0.020)), with: .color(wood))

        let apex = p(0.265, 0.115)
        let edges: [Double] = [0.055, 0.165, 0.285, 0.405, 0.485]
        let colors = [Color(red: 0.47, green: 0.63, blue: 0.55),
                      Color(red: 0.70, green: 0.77, blue: 0.61),
                      Color(red: 0.85, green: 0.81, blue: 0.60),
                      Color(red: 0.58, green: 0.70, blue: 0.59)]
        for i in 0..<4 {
            let left = p(edges[i], 0.285), right = p(edges[i + 1], 0.285)
            var panel = Path(); panel.move(to: apex)
            panel.addQuadCurve(to: left, control: p((0.265 + edges[i]) / 2 - 0.025, 0.12))
            panel.addQuadCurve(to: right, control: p((edges[i] + edges[i + 1]) / 2, 0.245))
            panel.addQuadCurve(to: apex, control: p((0.265 + edges[i + 1]) / 2 + 0.025, 0.12))
            context.fill(panel, with: .linearGradient(Gradient(colors: [colors[i], colors[i].opacity(0.92)]), startPoint: apex, endPoint: right))
            context.stroke(panel, with: .color(wood.opacity(0.55)), lineWidth: max(0.6, w * 0.0016))
            // Subtle cloth strokes give the canopy a softer painted finish.
            var texture = context
            texture.clip(to: panel)
            for j in 0..<22 {
                let x = edges[i] + Double(j) * 0.006
                var stroke = Path(); stroke.move(to: p(x, 0.13)); stroke.addLine(to: p(x + 0.014, 0.29))
                texture.stroke(stroke, with: .color(PondStyle.cream.opacity(j.isMultiple(of: 3) ? 0.15 : 0.06)), lineWidth: w * 0.002)
            }
        }
        var cap = Path(); cap.move(to: p(0.265, 0.10)); cap.addLine(to: apex)
        context.stroke(cap, with: .color(wood), style: StrokeStyle(lineWidth: w * 0.005, lineCap: .round))
    }

    static func atmosphere(context: inout GraphicsContext, size: CGSize, condition: WeatherCondition, time: Double, still: Bool) {
        let w = size.width, h = size.height
        if condition.isRaining {
            let storm = condition == .thunderstorm
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.19, green: 0.27, blue: 0.34).opacity(storm ? 0.34 : 0.15)))
            for i in 0..<(storm ? 105 : 60) {
                let seed = Double(i)
                let x = (seed * 0.6180339).truncatingRemainder(dividingBy: 1)
                let y = (seed * 0.371 + time * (storm ? 0.85 : 0.57)).truncatingRemainder(dividingBy: 1)
                // The canopy actually shelters the cat: no streaks under its roof.
                if x > 0.045 && x < 0.49 && y > 0.25 && y < 0.79 { continue }
                var drop = Path(); drop.move(to: CGPoint(x: x * w, y: y * h))
                drop.addLine(to: CGPoint(x: (x - 0.008) * w, y: (y + 0.026) * h))
                context.stroke(drop, with: .color(PondStyle.cream.opacity(still ? 0.22 : 0.40)), style: StrokeStyle(lineWidth: max(0.65, w * 0.0018), lineCap: .round))
            }
            for i in 0..<12 {
                let phase = (time * 0.8 + Double(i) * 0.137).truncatingRemainder(dividingBy: 1)
                let x = (0.48 + Double(i % 4) * 0.13) * w
                let y = (0.57 + Double(i / 4) * 0.13) * h
                let width = w * (0.01 + phase * 0.045)
                context.stroke(Path(ellipseIn: CGRect(x: x - width / 2, y: y, width: width, height: width * 0.23)),
                               with: .color(PondStyle.cream.opacity((1 - phase) * 0.40)), lineWidth: max(0.6, w * 0.0015))
            }
        } else if condition == .fog {
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.86, green: 0.90, blue: 0.87).opacity(0.22)))
            for i in 0..<5 {
                let drift = sin(time * 0.09 + Double(i)) * w * 0.10
                let rect = CGRect(x: -w * 0.2 + drift, y: h * (0.21 + Double(i) * 0.15), width: w * 1.4, height: h * 0.22)
                var mist = context
                mist.addFilter(.blur(radius: w * 0.045))
                mist.fill(Path(ellipseIn: rect), with: .color(PondStyle.cream.opacity(0.20)))
            }
        }
    }
}
