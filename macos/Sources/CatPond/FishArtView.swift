import SwiftUI
import PondCore

extension FishSpecies {
    /// Atlas coordinates are kept in source pixels, preserving each fish's complete fins.
    var spriteBounds: CGRect {
        switch self {
        case .peach: return CGRect(x: 14, y: 90, width: 476, height: 376)
        case .sunshine: return CGRect(x: 508, y: 82, width: 503, height: 399)
        case .mint: return CGRect(x: 1026, y: 101, width: 502, height: 373)
        case .blueberry: return CGRect(x: 10, y: 542, width: 477, height: 391)
        case .moon: return CGRect(x: 492, y: 556, width: 548, height: 391)
        }
    }
    var swimSpeed: Double {
        switch self {
        case .peach: return 0.075
        case .sunshine: return 0.105
        case .mint: return 0.19
        case .blueberry: return 0.14
        case .moon: return 0.06
        }
    }
    var swimSize: CGFloat {
        switch self {
        case .peach: return 76
        case .sunshine: return 98
        case .mint: return 88
        case .blueberry: return 82
        case .moon: return 112
        }
    }
    var personality: String {
        switch self {
        case .peach: return "慢悠悠的圓滾滾"
        case .sunshine: return "輕搖扇尾的舞者"
        case .mint: return "荷葉間的小快艇"
        case .blueberry: return "愛四處張望的探險家"
        case .moon: return "沿著月光緩緩滑行"
        }
    }
}

/// Native sprite-atlas rendering; multiply compositing preserves the watercolor edges
/// against the paper/water backgrounds without pretending the source has an alpha channel.
struct FishDrawing: View {
    let species: FishSpecies
    var body: some View {
        GeometryReader { geometry in
            let bounds = species.spriteBounds
            let scale = min(geometry.size.width / bounds.width, geometry.size.height / bounds.height)
            Image(nsImage: Artwork.fishAtlas).resizable()
                .frame(width: 1536 * scale, height: 1024 * scale)
                .offset(x: -bounds.minX * scale, y: -bounds.minY * scale)
                .frame(width: bounds.width * scale, height: bounds.height * scale, alignment: .topLeading)
                .clipped()
                .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
        }
        .compositingGroup().blendMode(.multiply)
        .accessibilityLabel(species.name)
    }
}

struct HydrationCup: View {
    @ObservedObject var store: PondStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let still = reduceMotion
        let animate = !still && store.hydrationAmount > 0
        return Button { store.openDetails?("records") } label: {
            VStack(spacing: 3) {
                ZStack(alignment: .bottom) {
                    CupShape().fill(.white.opacity(0.17))
                    Rectangle().fill(LinearGradient(colors: [Color(red: 0.52, green: 0.81, blue: 0.82), PondStyle.teal.opacity(0.85)], startPoint: .top, endPoint: .bottom))
                        .frame(height: 40 * store.progress)
                        .overlay(alignment: .top) { Capsule().fill(.white.opacity(0.65)).frame(height: 2).opacity(store.progress > 0 ? 1 : 0) }
                        .padding(.horizontal, 3).padding(.bottom, 3)
                        .clipShape(CupShape())
                    CupShape().stroke(.white.opacity(0.85), lineWidth: 1.5)
                    Ellipse().stroke(.white.opacity(0.8), lineWidth: 1).frame(height: 6).frame(maxHeight: .infinity, alignment: .top)
                    Capsule().fill(.white.opacity(0.60)).frame(width: 2, height: 24).rotationEffect(.degrees(-3)).offset(x: -10, y: -12)
                }.frame(width: 35, height: 46)
                    .shadow(color: .black.opacity(0.18), radius: 2, y: 3)
                    .keyframeAnimator(initialValue: 1.0, trigger: store.hydrationTrigger) { content, scale in
                        content.scaleEffect(animate ? scale : 1, anchor: .bottom)
                    } keyframes: { _ in
                        CubicKeyframe(1.14, duration: 0.16)
                        CubicKeyframe(0.97, duration: 0.18)
                        CubicKeyframe(1.0, duration: 0.20)
                    }
                Text("\(store.total) ml").font(.system(size: 11, weight: .medium, design: .rounded)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(PondStyle.cream.opacity(0.97), in: Capsule())
            }.frame(width: 84, height: 71)
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .overlay(alignment: .top) {
                    Text("＋\(store.hydrationAmount) ml")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(PondStyle.teal)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(PondStyle.cream.opacity(0.97), in: Capsule())
                        .fixedSize()
                        .keyframeAnimator(initialValue: 0.0, trigger: store.hydrationTrigger) { content, elapsed in
                            content
                                .offset(y: still ? -27 : -20 - 18 * elapsed / 1.5)
                                .opacity(still ? 1 : min(1, max(0, (1.5 - elapsed) / 0.4)))
                        } keyframes: { _ in
                            MoveKeyframe(0)
                            LinearKeyframe(1.5, duration: 1.5)
                        }
                        .opacity(store.hydrationAmount > 0 ? 1 : 0)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
            }
            .foregroundStyle(PondStyle.ink)
            .help("今日 \(store.total) / \(store.data.goal) ml\n\(store.fishingProgressText)\n點一下查看或記錄喝水")
            .accessibilityLabel("今日喝水 \(store.total) 毫升，目標 \(store.data.goal) 毫升。\(store.fishingProgressText)。開啟喝水紀錄")
            .animation(reduceMotion || store.hydrationAmount == 0 ? nil : .easeInOut(duration: 0.6), value: store.progress)
    }
}

private struct CupShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 1, y: rect.minY + 3))
        path.addLine(to: CGPoint(x: rect.maxX - 1, y: rect.minY + 3))
        path.addLine(to: CGPoint(x: rect.maxX - 5, y: rect.maxY - 4))
        path.addQuadCurve(to: CGPoint(x: rect.minX + 5, y: rect.maxY - 4), control: CGPoint(x: rect.midX, y: rect.maxY + 2))
        path.closeSubpath()
        return path
    }
}
