import SwiftUI
import Charts
import PondCore

struct QuickLog: View {
    @ObservedObject var store: PondStore
    @State private var custom = ""
    var body: some View { QuickLogForm(store: store, custom: $custom) }
}

struct QuickLogForm: View {
    @ObservedObject var store: PondStore
    @Binding var custom: String
    private var amount: Int? { PondInput.amount(custom, range: 1...5000) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ForEach([100, 200, 300], id: \.self) { amount in
                    Button("＋\(amount) ml") { store.log(amount: amount) }.buttonStyle(.bordered).controlSize(.large)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("自訂水量").font(.system(size: 11, weight: .medium)).foregroundStyle(PondStyle.muted)
                HStack(spacing: 8) {
                    TextField("1～5000", text: $custom).textFieldStyle(.roundedBorder).frame(width: 105)
                        .onSubmit(save).accessibilityLabel("自訂喝水量，1 到 5000 毫升")
                    Text("ml").font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                    Button("記錄", action: save).disabled(amount == nil).buttonStyle(.borderedProminent)
                }
                if !custom.isEmpty && amount == nil {
                    Label("請輸入 1～5000 的整數", systemImage: "exclamationmark.circle")
                        .font(.system(size: 11)).foregroundStyle(.red)
                }
            }
        }
    }
    private func save() { if let amount, store.log(amount: amount) { custom = "" } }
}

struct MenuContent: View {
    @ObservedObject var store: PondStore
    @ObservedObject var bluetooth: BluetoothManager
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Image(systemName: "drop.fill").foregroundStyle(PondStyle.teal); Text("今天也慢慢來").font(.headline); Spacer() }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(store.total)").font(.system(size: 32, weight: .semibold, design: .rounded))
                Text("/ \(store.data.goal) ml").foregroundStyle(.secondary)
            }
            ProgressView(value: store.progress).tint(PondStyle.teal)
            Text(store.fishingProgressText).font(.caption).foregroundStyle(PondStyle.teal)
            Button { store.openDetails?("settings") } label: {
                Label(store.weatherSummary, systemImage: store.currentWeather?.condition.symbol ?? "cloud")
                    .font(.caption)
            }.buttonStyle(.plain).help(store.weatherDetail)
            QuickLog(store: store)
            if let toast = store.toast { Text(toast).font(.caption).foregroundStyle(PondStyle.teal) }
            if let error = store.error { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            Divider()
            Label(bluetooth.status, systemImage: bluetooth.connected ? "antenna.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("顯示池塘") { store.showPond?() }
                Button("喝水紀錄") { store.openDetails?("records") }
                Button("魚缸") { store.openDetails?("aquarium") }
            }.buttonStyle(.borderless)
            HStack {
                Button("設定與杯墊") { store.openDetails?("settings") }
                Spacer()
                Button("結束") { NSApp.terminate(nil) }.keyboardShortcut("q")
            }.buttonStyle(.borderless).font(.caption)
        }.padding(22).frame(width: 330).foregroundStyle(PondStyle.ink).background(PondStyle.cream)
    }
}

struct DetailView: View {
    @ObservedObject var store: PondStore
    @ObservedObject var bluetooth: BluetoothManager
    @Binding var selection: String
    @State private var collectionFilter = CollectionFilter.all
    @State private var visibleRecords = 50
    @State private var recordAmount = ""
    @State private var goalDraft = ""

    var body: some View {
        NavigationSplitView {
            sidebar.navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 230)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let error = store.error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout).foregroundStyle(.red).padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                    }
                    switch selection {
                    case "records": RecordsView(store: store, visibleCount: $visibleRecords, custom: $recordAmount)
                    case "collection": CollectionView(store: store, filter: $collectionFilter)
                    case "settings": SettingsView(store: store, bluetooth: bluetooth, goal: $goalDraft)
                    default: AquariumPage(store: store, selection: $selection)
                    }
                }.padding(28).frame(maxWidth: 1140, alignment: .leading).frame(maxWidth: .infinity)
            }.id(selection).background(PondStyle.paper)
        }
        .navigationSplitViewStyle(.balanced)
        .foregroundStyle(PondStyle.ink).tint(PondStyle.teal)
        .environment(\.colorScheme, .light)
        .frame(minWidth: 800, minHeight: 590)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "fish").font(.system(size: 21, weight: .light)).foregroundStyle(PondStyle.teal)
                Text("小貓釣魚").font(.system(size: 23, weight: .semibold, design: .serif))
            }.padding(.top, 12)
            Text("一口水，一點小驚喜。").font(.system(size: 11)).foregroundStyle(PondStyle.muted).padding(.bottom, 28)
            sidebarButton("aquarium", "我的魚缸", "fish", badge: nil)
            sidebarButton("collection", "魚兒圖鑑", "book.closed", badge: "\(Set(store.data.fish.map(\.species)).count)/8")
            sidebarButton("records", "喝水紀錄", "drop", badge: nil)
            sidebarButton("settings", "設定與杯墊", "slider.horizontal.3", badge: nil)
            Spacer(minLength: 28)
            VStack(alignment: .leading, spacing: 10) {
                HStack { Text("今日喝水"); Spacer(); Text("\(Int(store.progress * 100))%").monospacedDigit() }
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(PondStyle.muted)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(store.total.formatted()).font(.system(size: 24, weight: .medium, design: .rounded)).monospacedDigit()
                    Text("/ \(store.data.goal) ml").font(.system(size: 10)).foregroundStyle(PondStyle.muted)
                }
                ProgressView(value: store.progress).tint(PondStyle.teal)
            }.padding(14).background(PondStyle.surface.opacity(0.8), in: RoundedRectangle(cornerRadius: 15))
            Button { store.showPond?() } label: {
                HStack {
                    Label("回到小池塘", systemImage: "arrow.up.forward.square")
                    Spacer(minLength: 0)
                }.frame(maxWidth: .infinity).padding(.vertical, 9)
            }.buttonStyle(.borderless).font(.system(size: 12, weight: .medium)).padding(.top, 8)
            Text("\(store.data.tickets) 次待收竿 · \(store.data.fish.count) 位朋友")
                .font(.system(size: 11)).foregroundStyle(PondStyle.muted).padding(.bottom, 8)
        }.padding(18).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(PondStyle.cream)
    }

    private func sidebarButton(_ id: String, _ title: String, _ icon: String, badge: String?) -> some View {
        Button { selection = id } label: {
            HStack(spacing: 11) {
                Image(systemName: icon).font(.system(size: 16)).frame(width: 21)
                Text(title).font(.system(size: 13, weight: selection == id ? .semibold : .regular))
                Spacer(minLength: 0)
                if let badge { Text(badge).font(.system(size: 10)).monospacedDigit() }
            }.padding(.horizontal, 12).padding(.vertical, 13)
                .foregroundStyle(selection == id ? PondStyle.teal : PondStyle.ink)
                .background(selection == id ? PondStyle.teal.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 12))
                .contentShape(RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(PondHoverButtonStyle(radius: 12)).accessibilityAddTraits(selection == id ? .isSelected : [])
    }
}
