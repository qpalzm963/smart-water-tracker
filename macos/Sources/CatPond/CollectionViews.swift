import SwiftUI
import PondCore

enum CollectionFilter: String, CaseIterable {
    case all = "全部", collected = "已相遇", undiscovered = "未相遇"
}

struct CollectionView: View {
    @ObservedObject var store: PondStore
    @Binding var filter: CollectionFilter
    @State private var selected: FishSpecies?
    private var discovered: Set<FishSpecies> { Set(store.data.fish.map(\.species)) }
    private var species: [FishSpecies] {
        FishSpecies.allCases.filter { filter == .all || (filter == .collected ? discovered.contains($0) : !discovered.contains($0)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            PageHeader(title: "魚兒圖鑑", subtitle: "每一位朋友，都有自己的故事。", eyebrow: "相遇的紀念")
            HStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(discovered.count)").font(.system(size: 36, weight: .medium, design: .rounded))
                        Text("/ \(FishSpecies.allCases.count) 種已相遇").font(.system(size: 13)).foregroundStyle(PondStyle.muted)
                    }
                    ProgressView(value: Double(discovered.count), total: Double(FishSpecies.allCases.count)).frame(maxWidth: 260)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text("\(store.data.fish.count) 隻收藏").font(.system(size: 14, weight: .medium))
                    Text("雨天、雷雨與霧天藏著限定朋友").font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                }
            }.padding(22).background(PondStyle.teal.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
            Picker("收藏狀態", selection: $filter) {
                ForEach(CollectionFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }.pickerStyle(.segmented).frame(maxWidth: 320)
            if species.isEmpty {
                PondEmptyState(title: filter == .undiscovered ? "所有朋友都相遇了" : "故事從第一尾魚開始", message: filter == .undiscovered ? "每一次收竿，還能收藏新的相遇時刻。" : "回到小池塘收竿，迎接第一位朋友。", symbol: "book.closed")
                if filter == .collected {
                    Button("回到小池塘") { store.showPond?() }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                }
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 18)], spacing: 18) {
                    ForEach(species) { fish in
                        speciesCard(fish)
                    }
                }
            }
        }.sheet(item: $selected) { fish in
            FishDetailSheet(species: fish, catches: store.data.fish.filter { $0.species == fish })
        }
    }

    private func speciesCard(_ species: FishSpecies) -> some View {
        let count = store.data.fish.filter { $0.species == species }.count
        return Button { selected = species } label: {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 16).fill(species.color.opacity(count > 0 ? 0.12 : 0.04))
                    FishDrawing(species: species).frame(width: 150, height: 120)
                        .saturation(count > 0 ? 1 : 0).opacity(count > 0 ? 1 : 0.26)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    if count > 0 {
                        Text("×\(count)").font(.system(size: 11, weight: .semibold)).monospacedDigit()
                            .padding(.horizontal, 9).padding(.vertical, 5).background(.white.opacity(0.8), in: Capsule()).padding(12)
                    } else {
                        Image(systemName: "lock").font(.system(size: 12)).foregroundStyle(PondStyle.muted).padding(14)
                    }
                }.frame(height: 145)
                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        Text(count > 0 ? species.name : "尚未相遇").font(.system(size: 17, weight: .semibold, design: .serif))
                        Spacer()
                        Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(PondStyle.muted)
                    }
                    Text(count > 0 ? species.personality : "下一次收竿，也許就會遇見牠。")
                        .font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                    InfoPill(text: species.requiredWeather.map { "\($0.name)限定" } ?? species.rarity,
                             symbol: species.requiredWeather?.symbol)
                }.padding(16)
            }.background(PondStyle.surface, in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(PondStyle.line.opacity(0.7)))
                .contentShape(RoundedRectangle(cornerRadius: 18))
        }.buttonStyle(PondHoverButtonStyle(radius: 18)).accessibilityLabel(count > 0 ? "\(species.name)，已收藏 \(count) 隻，查看詳情" : "尚未相遇，\(species.requiredWeather?.name ?? "一般天氣")魚種，查看相遇條件")
    }
}

struct FishDetailSheet: View {
    let species: FishSpecies
    let catches: [CaughtFish]
    var selected: CaughtFish? = nil
    @Environment(\.dismiss) private var dismiss
    private var latest: CaughtFish? { catches.max { $0.date < $1.date } }
    private var first: CaughtFish? { catches.min { $0.date < $1.date } }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(catches.isEmpty ? "等待相遇" : "魚兒小檔案").font(.system(size: 12, weight: .medium)).foregroundStyle(PondStyle.muted)
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").frame(width: 24, height: 24) }
                    .buttonStyle(.borderless).help("關閉魚兒詳情").accessibilityLabel("關閉魚兒詳情").keyboardShortcut(.cancelAction)
            }.padding(20)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    FishDrawing(species: species).frame(width: 240, height: 185)
                        .saturation(catches.isEmpty ? 0 : 1).opacity(catches.isEmpty ? 0.3 : 1)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(species.color.opacity(0.10), in: RoundedRectangle(cornerRadius: 20))
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Text(catches.isEmpty ? "尚未相遇的朋友" : species.name).font(.system(size: 27, weight: .semibold, design: .serif))
                            Spacer()
                            InfoPill(text: species.rarity)
                        }
                        if !catches.isEmpty {
                            Text(species.personality).font(.system(size: 13, weight: .medium)).foregroundStyle(PondStyle.teal)
                            Text(species.story).font(.system(size: 14)).foregroundStyle(PondStyle.muted)
                        }
                    }
                    Divider()
                    if let selected {
                        detailRow("這次相遇", value: selected.date.formatted(date: .abbreviated, time: .shortened))
                        if let city = selected.city { detailRow("相遇地點", value: city.name) }
                        if let weather = selected.weather { detailRow("當時天氣", value: weather.name) }
                    }
                    if let first, let latest {
                        detailRow("已收藏", value: "\(catches.count) 隻")
                        detailRow("初次相遇", value: first.date.formatted(date: .abbreviated, time: .omitted))
                        if selected == nil {
                            detailRow("最近相遇", value: latest.date.formatted(date: .abbreviated, time: .shortened))
                            if let city = latest.city { detailRow("最近地點", value: city.name) }
                            if let weather = latest.weather { detailRow("當時天氣", value: weather.name) }
                        }
                    }
                    if let weather = species.requiredWeather {
                        Label("\(weather.name)時收竿，有 20% 機會相遇。", systemImage: weather.symbol)
                            .font(.system(size: 13)).foregroundStyle(PondStyle.teal)
                    } else if catches.isEmpty {
                        Text("一般魚池就有機會遇見牠。魚的稀有度與喝水量無關。")
                            .font(.system(size: 13)).foregroundStyle(PondStyle.muted)
                    }
                }.padding(.horizontal, 26).padding(.bottom, 26)
            }
            Button("完成") { dismiss() }.buttonStyle(.borderedProminent).controlSize(.large)
                .keyboardShortcut(.defaultAction).frame(maxWidth: .infinity, alignment: .trailing).padding(20)
        }.frame(width: 490, height: 620).background(PondStyle.paper).foregroundStyle(PondStyle.ink)
            .tint(PondStyle.teal).environment(\.colorScheme, .light)
    }
    private func detailRow(_ label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).foregroundStyle(PondStyle.muted)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }.font(.system(size: 13))
    }
}
