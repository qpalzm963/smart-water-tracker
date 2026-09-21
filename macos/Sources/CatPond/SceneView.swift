import SwiftUI
import AppKit
import PondCore

enum Artwork {
    static let pond = load("pond")
    static let blink = load("pond-blink")
    static let fishAtlas = load("fish-atlas")
    static let pull = load("pond-pull")
    static let lift = load("pond-lift")
    static let happy = load("pond-happy")
    private static func load(_ name: String) -> NSImage {
        let packaged = Bundle.main.resourceURL?.appendingPathComponent("CatPond_CatPond.bundle/\(name).png")
        let url = packaged.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
            ?? Bundle.module.url(forResource: name, withExtension: "png")
        guard let url, let image = NSImage(contentsOf: url) else {
            preconditionFailure("Missing packaged artwork: \(name)")
        }
        return image
    }
}

enum PondStyle {
    static let cream = Color(red: 0.98, green: 0.96, blue: 0.90)
    static let ink = Color(red: 0.27, green: 0.29, blue: 0.25)
    static let teal = Color(red: 0.26, green: 0.49, blue: 0.46)
    static let coral = Color(red: 0.77, green: 0.40, blue: 0.28)
}

extension FishSpecies {
    var color: Color {
        switch self {
        case .peach: return Color(red: 0.91, green: 0.56, blue: 0.42)
        case .sunshine: return Color(red: 0.92, green: 0.70, blue: 0.28)
        case .mint: return Color(red: 0.39, green: 0.68, blue: 0.56)
        case .blueberry: return Color(red: 0.38, green: 0.56, blue: 0.72)
        case .moon: return Color(red: 0.68, green: 0.61, blue: 0.79)
        }
    }
}

struct PondScene: View {
    @ObservedObject var store: PondStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                FishingSceneLayer(store: store, reduceMotion: reduceMotion)
                    .allowsHitTesting(false)
                WindowDragArea().accessibilityHidden(true)
                if store.caught == nil {
                    HydrationCup(store: store)
                        .position(x: geometry.size.width * 0.17, y: geometry.size.height * 0.765)
                    if store.data.tickets == 0 || store.isReeling {
                        VStack { Spacer(); HStack {
                            Spacer()
                            Label("×\(store.data.tickets)", systemImage: "fish")
                                .font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit()
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(PondStyle.cream.opacity(0.95), in: Capsule())
                                .accessibilityLabel("剩餘 \(store.data.tickets) 次釣魚機會")
                                .help(store.fishingProgressText)
                        }.padding(14) }
                    }
                }
                if store.data.tickets > 0 && store.caught == nil && !store.isReeling {
                    VStack { Spacer(); HStack { Spacer()
                        Button { store.reel(reduceMotion: reduceMotion) } label: {
                            Label("收竿 ×\(store.data.tickets)", systemImage: "fish.fill").font(.system(size: 13, weight: .semibold)).monospacedDigit()
                                .padding(.horizontal, 18).padding(.vertical, 10)
                        }.buttonStyle(.plain).foregroundStyle(.white)
                            .background(PondStyle.coral, in: Capsule()).help("魚兒上鉤了，點一下收竿")
                            .padding(18)
                    }}
                }
                if hovering {
                    VStack { HStack(spacing: 6) {
                        sceneButton("xmark", "隱藏池塘") { store.hidePond?() }
                        sceneButton(store.data.pinned ? "pin.fill" : "pin", store.data.pinned ? "取消置頂" : "置頂") { store.togglePin() }
                        Spacer()
                        sceneButton("drop", "記錄喝水") { store.openDetails?("records") }
                        sceneButton("arrow.up.left.and.arrow.down.right", "展開魚缸與紀錄") { store.openDetails?("aquarium") }
                    }.padding(12); Spacer() }.transition(.opacity)
                }
                if let fish = store.caught {
                    catchCard(fish, compact: geometry.size.height < 310).padding(20).transition(.scale(scale: 0.9).combined(with: .opacity))
                }
                if store.error != nil {
                    VStack { Spacer(); Button("紀錄儲存發生問題 · 查看") { store.openDetails?("records") }
                        .padding(10).background(PondStyle.cream, in: Capsule()).padding(12) }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .foregroundStyle(PondStyle.ink)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(.white.opacity(0.3), lineWidth: 1))
            .onHover { hovering = $0 }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: hovering)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.caught)
            .contextMenu {
                Button("記錄喝水") { store.openDetails?("records") }
                Button("我的魚缸") { store.openDetails?("aquarium") }
                Button(store.data.pinned ? "取消置頂" : "置頂") { store.togglePin() }
                Button("隱藏池塘") { store.hidePond?() }
            }
        }
    }

    private func sceneButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 12, weight: .semibold)).frame(width: 29, height: 29) }
            .buttonStyle(.plain).background(PondStyle.cream.opacity(0.94), in: Circle()).help(label).accessibilityLabel(label)
    }

    private func catchCard(_ fish: CaughtFish, compact: Bool) -> some View {
        VStack(spacing: compact ? 6 : 9) {
            Text("今天的小驚喜").font(.system(size: 12, weight: .medium)).foregroundStyle(PondStyle.teal)
            FishDrawing(species: fish.species).frame(width: compact ? 116 : 160, height: compact ? 78 : 112)
            Text(fish.species.name).font(.system(size: compact ? 18 : 21, weight: .semibold, design: .serif))
            Text(fish.species.rarity).font(.caption).foregroundStyle(.secondary)
            Button("收進魚缸") { store.dismissCatch() }.buttonStyle(.borderedProminent).tint(PondStyle.coral)
        }.frame(maxWidth: compact ? 220 : 250).padding(compact ? 14 : 20)
            .background(PondStyle.cream, in: RoundedRectangle(cornerRadius: 22))
            .compositingGroup()
            .shadow(color: .black.opacity(0.12), radius: 20, y: 8)
    }

}

struct WindowDragArea: NSViewRepresentable {
    final class DragView: NSView {
        override var mouseDownCanMoveWindow: Bool { true }
        override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
    }
    func makeNSView(context: Context) -> DragView { DragView() }
    func updateNSView(_ nsView: DragView, context: Context) {}
}
