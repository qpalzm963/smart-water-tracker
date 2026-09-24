import SwiftUI
import PondCore

struct AquariumPage: View {
    @ObservedObject var store: PondStore
    @Binding var selection: String
    @State private var selectedFish: CaughtFish?
    @State private var paused = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var displayed: [CaughtFish] { DetailData.displayedFish(store.data.fish) }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top) {
                PageHeader(title: "我的魚缸", subtitle: "把相遇的每一刻，養成眼前的小風景。", eyebrow: "一缸小日常")
                Spacer()
                Button { selection = "collection" } label: { Label("魚兒圖鑑", systemImage: "book.closed") }
                    .buttonStyle(.bordered).controlSize(.large)
            }
            VStack(spacing: 0) {
                ZStack {
                    AquariumView(fish: displayed, decoration: store.data.decoration,
                                 paused: paused || selectedFish != nil, onSelect: { selectedFish = $0 })
                    if displayed.isEmpty {
                        VStack(spacing: 12) {
                            Text("第一位朋友，正在路上").font(.system(size: 23, weight: .semibold, design: .serif))
                            Text(store.data.tickets > 0 ? "你已經有釣魚機會，回池塘迎接牠吧。" : "每累積 200 ml，就能獲得一次釣魚機會。")
                                .font(.system(size: 13)).foregroundStyle(PondStyle.muted)
                            Button(store.data.tickets > 0 ? "回池塘收竿" : "記錄第一杯水") {
                                if store.data.tickets > 0 { store.showPond?() } else { selection = "records" }
                            }.buttonStyle(.borderedProminent).controlSize(.large)
                        }.padding(24).background(PondStyle.surface.opacity(0.93), in: RoundedRectangle(cornerRadius: 22)).padding(22)
                    }
                }.aspectRatio(1.85, contentMode: .fit).frame(minHeight: 285, maxHeight: 480).clipped()
                HStack(spacing: 14) {
                    Label("\(displayed.count) 位朋友在魚缸", systemImage: "fish").font(.system(size: 12, weight: .medium))
                    Spacer(minLength: 4)
                    if !displayed.isEmpty {
                        Button { paused.toggle() } label: {
                            Label(reduceMotion ? "靜態觀賞" : paused ? "繼續游動" : "暫停游動", systemImage: reduceMotion || paused ? "play" : "pause")
                        }.buttonStyle(.borderless).font(.system(size: 12)).disabled(reduceMotion)
                            .help(reduceMotion ? "已依系統設定減少動態效果" : "暫停後可更容易點選魚兒")
                    }
                }.padding(.horizontal, 20).padding(.vertical, 15).background(PondStyle.surface)
            }.clipShape(RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(PondStyle.line.opacity(0.65)))

            HStack(alignment: .firstTextBaseline) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text("\(store.data.fish.count)").font(.system(size: 25, weight: .medium, design: .rounded)).monospacedDigit()
                    Text("隻收藏").font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                    Text("·").padding(.horizontal, 8).foregroundStyle(PondStyle.line)
                    Text("\(Set(store.data.fish.map(\.species)).count) / 8").font(.system(size: 25, weight: .medium, design: .rounded)).monospacedDigit()
                    Text("種相遇").font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                }
                Spacer()
                Text("展示最近 12 隻").font(.system(size: 11)).foregroundStyle(PondStyle.muted)
            }
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle(title: "換個小風景")
                HStack(spacing: 12) {
                    ForEach(["水草", "石頭", "小屋"], id: \.self) { item in
                        decorationChoice(item)
                    }
                }
            }
            PondCard {
                HStack(spacing: 16) {
                    Image(systemName: store.data.tickets > 0 ? "fish" : "drop")
                        .font(.system(size: 25, weight: .light)).foregroundStyle(PondStyle.teal)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.data.tickets > 0 ? "還有 \(store.data.tickets) 次相遇等著你" : "喝一口水，離下一次相遇更近")
                            .font(.system(size: 14, weight: .semibold))
                        Text(store.fishingProgressText).font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Button(store.data.tickets > 0 ? "回池塘收竿" : "記錄喝水") {
                        if store.data.tickets > 0 { store.showPond?() } else { selection = "records" }
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                }
            }
        }.sheet(item: $selectedFish) { fish in
            FishDetailSheet(species: fish.species, catches: store.data.fish.filter { $0.species == fish.species }, selected: fish)
        }
    }

    private func decorationChoice(_ item: String) -> some View {
        let selected = store.data.decoration == item
        return Button { store.decorate(item) } label: {
            VStack(spacing: 0) {
                AquariumBackdrop(decoration: item).frame(height: 75).clipped().accessibilityHidden(true)
                HStack {
                    Text(item).font(.system(size: 12, weight: .medium))
                    Spacer()
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle").foregroundStyle(selected ? PondStyle.teal : PondStyle.muted)
                }.padding(12).background(selected ? PondStyle.teal.opacity(0.08) : PondStyle.surface)
            }.clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? PondStyle.teal : PondStyle.line, lineWidth: selected ? 2 : 1))
                .contentShape(RoundedRectangle(cornerRadius: 14))
        }.buttonStyle(PondHoverButtonStyle(radius: 14)).accessibilityLabel("\(item)佈置").accessibilityValue(selected ? "已選取" : "未選取")
    }
}

struct AquariumPlacement {
    let x: Double
    let y: Double
    let facing: Double
    static func sample(index: Int, time: Double, speed: Double) -> Self {
        let offset = Double(index) * 2.399963
        let pace = (0.13 + speed * 0.45) * (1 + Double(index % 3) * 0.035)
        let phase = time * pace + offset
        // Cross most of the tank, easing into each turn; depth has its own slower rhythm.
        // The atlas faces right, so the horizontal derivative also determines the heading.
        return Self(x: 0.50 + sin(phase) * 0.38,
                    y: 0.46 + sin(time * pace * 0.43 + offset * 1.7) * 0.20
                        + sin(time * pace * 0.91 + offset) * 0.035,
                    facing: tanh(cos(phase) * 8))
    }
}

struct AquariumView: View {
    let fish: [CaughtFish]
    let decoration: String
    var paused = false
    var onSelect: ((CaughtFish) -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var elapsed: TimeInterval = 0
    @State private var startedAt = Date()
    private var moving: Bool { !paused && !reduceMotion }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                AquariumBackdrop(decoration: decoration).accessibilityHidden(true)
                TimelineView(.animation(minimumInterval: 1.0 / 20, paused: !moving)) { timeline in
                    let time = elapsed + (moving ? timeline.date.timeIntervalSince(startedAt) : 0)
                    ZStack {
                        ForEach(Array(fish.prefix(12).enumerated()), id: \.element.id) { index, caught in
                            fishButton(caught, index: index, time: time, size: geometry.size)
                        }
                    }
                }.blendMode(.multiply)
            }.compositingGroup()
        }.onChange(of: moving) { wasMoving, isMoving in
            if wasMoving { elapsed += Date().timeIntervalSince(startedAt) }
            if isMoving { startedAt = Date() }
        }
        .accessibilityElement(children: .contain).accessibilityLabel("魚缸，\(min(12, fish.count)) 隻魚，\(decoration)佈置")
    }

    private func fishButton(_ caught: CaughtFish, index: Int, time: Double, size: CGSize) -> some View {
        let point = AquariumPlacement.sample(index: index, time: time, speed: caught.species.swimSpeed)
        let width = min(caught.species.swimSize * 1.12, size.width * 0.17, (size.height * 0.18 - 8) / 0.82)
        return Button { onSelect?(caught) } label: {
            FishDrawing(species: caught.species)
                .scaleEffect(x: point.facing, y: 1)
                .frame(width: width, height: width * 0.82)
                .padding(4).contentShape(Ellipse())
        }.buttonStyle(PondHoverButtonStyle(radius: 50))
            .help("\(caught.species.name) · 點一下查看相遇紀錄")
            .accessibilityLabel("\(caught.species.name)，\(caught.date.formatted(date: .abbreviated, time: .omitted))捕獲")
            .position(x: size.width * point.x, y: size.height * point.y)
    }
}

struct AquariumBackdrop: View {
    let decoration: String
    var body: some View {
        GeometryReader { geometry in
            Image(nsImage: decoration == "小屋" ? Artwork.aquariumCottage : decoration == "石頭" ? Artwork.aquariumRocks : Artwork.aquarium).resizable().scaledToFill()
                .frame(width: geometry.size.width, height: geometry.size.height, alignment: .bottom).clipped()

        }.clipped()
    }
}
