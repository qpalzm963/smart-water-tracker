import SwiftUI
import Charts
import PondCore

struct QuickLog: View {
    @ObservedObject var store: PondStore
    @State private var custom = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ForEach([100, 200, 300], id: \.self) { amount in
                    Button("＋\(amount) ml") { store.log(amount: amount) }.buttonStyle(.bordered)
                }
            }
            HStack {
                TextField("自訂水量", text: $custom).textFieldStyle(.roundedBorder).frame(width: 100)
                    .onSubmit(save).accessibilityLabel("自訂喝水量，毫升")
                Text("ml").foregroundStyle(.secondary)
                Button("記錄", action: save).disabled(Int(custom) == nil).buttonStyle(.borderedProminent).tint(PondStyle.teal)
            }
        }
    }
    private func save() { if let amount = Int(custom), store.log(amount: amount) { custom = "" } }
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
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 8) {
                Text("小貓釣魚").font(.system(size: 25, weight: .semibold, design: .serif)).padding(.bottom, 2)
                Text("一口水，一點小驚喜。").font(.caption).foregroundStyle(.secondary).padding(.bottom, 24)
                sidebarButton("aquarium", "我的魚缸", "fish")
                sidebarButton("records", "喝水紀錄", "drop")
                sidebarButton("collection", "魚兒圖鑑", "book.closed")
                sidebarButton("settings", "設定與杯墊", "slider.horizontal.3")
                Spacer()
                Button { store.showPond?() } label: { Label("回到小池塘", systemImage: "arrow.up.forward.square") }
                    .buttonStyle(.borderless).padding(.bottom, 8)
                Text("\(store.data.fish.count) 位魚兒朋友\n\(store.data.tickets) 次待收竿").font(.caption).foregroundStyle(.secondary).lineSpacing(5)
            }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(PondStyle.cream)
                .navigationSplitViewColumnWidth(min: 190, ideal: 205, max: 240)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let error = store.error {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red).padding()
                            .background(.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                    }
                    switch selection {
                    case "records": RecordsView(store: store)
                    case "collection": collection
                    case "settings": SettingsView(store: store, bluetooth: bluetooth)
                    default: aquarium
                    }
                }.padding(32).frame(maxWidth: .infinity, alignment: .leading)
            }.background(Color(red: 0.99, green: 0.98, blue: 0.95))
        }
        .navigationSplitViewStyle(.balanced)
        .foregroundStyle(PondStyle.ink).tint(PondStyle.teal)
        .frame(minWidth: 800, minHeight: 590)
    }

    private func sidebarButton(_ id: String, _ title: String, _ icon: String) -> some View {
        Button { selection = id } label: {
            Label(title, systemImage: icon).frame(maxWidth: .infinity, alignment: .leading).padding(11)
                .background(selection == id ? PondStyle.teal.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).font(.system(size: 13, weight: selection == id ? .semibold : .regular))
    }
    private var aquarium: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageHeading("我的魚缸", subtitle: "把池塘的小驚喜，收進自己的日常。")
            AquariumView(fish: Array(store.data.fish.suffix(12)), decoration: store.data.decoration).frame(height: 300)
            if store.data.fish.isEmpty {
                Text("魚缸還在等第一位朋友。記錄喝水後，回小池塘收竿吧。")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                Text("已收藏 \(store.data.fish.count) 隻 · 魚缸展示最近 12 位朋友").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Text("魚缸佈置").font(.headline)
                Spacer()
                ForEach(["水草", "石頭", "小屋"], id: \.self) { item in
                    Button(item) { store.decorate(item) }
                        .buttonStyle(.bordered).tint(store.data.decoration == item ? PondStyle.teal : .gray)
                }
            }
            if store.data.tickets > 0 {
                Button("有 \(store.data.tickets) 次小驚喜等著你 · 回池塘收竿") { store.showPond?() }
                    .buttonStyle(.borderedProminent).tint(PondStyle.coral)
            }
            Text("每累積 200 ml 可獲得一次釣魚機會，每日最多 8 次。未滿的餘量跨日保留，機會不過期；魚的稀有度與水量無關。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text(store.fishingProgressText).font(.callout).foregroundStyle(PondStyle.teal)
        }
    }
    private var collection: some View {
        VStack(alignment: .leading, spacing: 20) {
            pageHeading("魚兒圖鑑", subtitle: "\(Set(store.data.fish.map(\.species)).count) / \(FishSpecies.allCases.count) 種朋友已相遇")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180))], spacing: 18) {
                ForEach(FishSpecies.allCases) { species in
                    let count = store.data.fish.filter { $0.species == species }.count
                    VStack(alignment: .leading, spacing: 10) {
                        FishDrawing(species: species).frame(height: 120).saturation(count > 0 ? 1 : 0).opacity(count > 0 ? 1 : 0.23)
                        Text(count > 0 ? species.name : "尚未相遇").font(.headline)
                        if let weather = species.requiredWeather {
                            Text("\(weather.name)限定 · 出現機率 20%").font(.caption).foregroundStyle(PondStyle.teal)
                        }
                        if count > 0 { Text(species.personality).font(.caption).foregroundStyle(PondStyle.teal) }
                        Text(count > 0 ? species.story : "下一次收竿，也許就會遇見牠。")
                            .font(.caption).foregroundStyle(.secondary).frame(height: 36, alignment: .top)
                        Text(count > 0 ? "\(species.rarity) · 已收藏 \(count) 隻" : "？")
                            .font(.caption2).foregroundStyle(PondStyle.teal)
                        if let latest = store.data.fish.last(where: { $0.species == species }),
                           let city = latest.city, let weather = latest.weather {
                            Text("最近相遇：\(city.name) · \(weather.name)")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }.padding(20).background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 18)).compositingGroup()
                }
            }
        }
    }
}

func pageHeading(_ title: String, subtitle: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
        Text(title).font(.system(size: 29, weight: .semibold, design: .serif))
        Text(subtitle).font(.callout).foregroundStyle(.secondary)
    }
}

struct AquariumView: View {
    let fish: [CaughtFish]
    let decoration: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation(minimumInterval: 1.0 / 20, paused: reduceMotion)) { timeline in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                ZStack {
                    LinearGradient(colors: [Color(red: 0.84, green: 0.92, blue: 0.87), Color(red: 0.38, green: 0.65, blue: 0.62)], startPoint: .top, endPoint: .bottom)
                    Canvas { context, size in
                        let w = size.width, h = size.height
                        context.fill(Path(CGRect(x: 0, y: h - 26, width: w, height: 26)), with: .color(Color(red: 0.78, green: 0.73, blue: 0.58)))
                        for i in 0..<10 {
                            let x = Double(i) * w / 9
                            var plant = Path(); plant.move(to: CGPoint(x: x, y: h - 20))
                            plant.addCurve(to: CGPoint(x: x + 14, y: h - Double(60 + i % 4 * 20)),
                                           control1: CGPoint(x: x - 20, y: h - 50), control2: CGPoint(x: x + 30, y: h - 90))
                            context.stroke(plant, with: .color(PondStyle.teal.opacity(0.48)), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        }
                        for i in 0..<7 {
                            let p = (time * 0.05 + Double(i) * 0.14).truncatingRemainder(dividingBy: 1)
                            let rect = CGRect(x: w * (0.1 + Double(i) * 0.13), y: h * (1 - p), width: 5, height: 5)
                            context.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(0.4)), lineWidth: 1)
                        }
                    }
                    ForEach(Array(fish.enumerated()), id: \.element.id) { index, caught in
                        let species = caught.species
                        let base = time * species.swimSpeed + Double(index) * 1.9
                        // Mint darts and pauses; blueberry explores; moon glides; peach gently bobs.
                        let phase = base + (species == .mint ? sin(base * 2) * 0.38 : species == .blueberry ? sin(base * 3) * 0.20 : 0)
                        let bob = sin(time * (species == .moon ? 0.45 : species == .peach ? 0.75 : 1.3) + Double(index))
                        FishDrawing(species: species).frame(width: species.swimSize, height: species.swimSize * 0.79)
                            .scaleEffect(x: tanh(cos(phase) * 7), y: 1 + bob * 0.012)
                            .rotationEffect(.degrees(bob * (species == .sunshine ? 4 : 1.5)))
                            .position(x: geometry.size.width * (0.5 + sin(phase) * 0.36),
                                      y: 58 + Double(index % 4) * 43 + bob * (species == .peach ? 10 : 5))
                    }
                    VStack { Spacer(); HStack { Spacer()
                        Image(systemName: decoration == "小屋" ? "house.fill" : decoration == "石頭" ? "mountain.2.fill" : "leaf.fill")
                            .font(.system(size: 48)).foregroundStyle(decoration == "小屋" ? PondStyle.coral.opacity(0.7) : PondStyle.ink.opacity(0.35))
                            .padding(.trailing, 34).padding(.bottom, 20)
                    }}
                }.compositingGroup()
            }
        }.clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(.white.opacity(0.65), lineWidth: 5))
            .accessibilityElement(children: .ignore).accessibilityLabel("魚缸，展示 \(fish.count) 隻魚，裝飾為\(decoration)")
    }
}

struct RecordsView: View {
    @ObservedObject var store: PondStore
    @State private var pendingDelete: WaterRecord?
    @State private var visibleCount = 50
    private var days: [Date] { (0..<7).reversed().compactMap { Calendar.current.date(byAdding: .day, value: -$0, to: store.now) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageHeading("喝水紀錄", subtitle: "照自己的步調，好好喝水。")
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("今天").foregroundStyle(.secondary)
                    Text("\(store.total) ml").font(.system(size: 38, weight: .medium, design: .rounded))
                    Text("每日目標 \(store.data.goal) ml").font(.caption).foregroundStyle(.secondary)
                    ProgressView(value: store.progress).tint(PondStyle.teal).frame(width: 170)
                }
                Spacer(minLength: 20)
                VStack(alignment: .leading, spacing: 12) { Text("記錄一杯水").font(.headline); QuickLog(store: store) }
            }.padding(22).background(PondStyle.cream, in: RoundedRectangle(cornerRadius: 18))
            if let toast = store.toast { Text(toast).font(.callout).foregroundStyle(PondStyle.teal) }
            Text(store.fishingProgressText).font(.caption).foregroundStyle(PondStyle.teal)
            VStack(alignment: .leading, spacing: 14) {
                Text("最近七天").font(.headline)
                Chart(days, id: \.self) { day in
                    BarMark(x: .value("日期", day, unit: .day), y: .value("喝水量", store.data.total(on: day)))
                        .foregroundStyle(PondStyle.teal.gradient).cornerRadius(5)
                }.chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.abbreviated)) } }
                    .chartYScale(domain: 0...max(store.data.goal, days.map { store.data.total(on: $0) }.max() ?? 0))
                    .frame(height: 150)
            }
            HStack { Text("歷史紀錄").font(.headline); Spacer(); Button("匯出紀錄", action: store.exportRecords).buttonStyle(.borderless) }
            if store.data.records.isEmpty {
                ContentUnavailableView("還沒有喝水紀錄", systemImage: "drop", description: Text("手動記錄第一杯水，或在設定中連接杯墊。"))
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(store.data.records.prefix(visibleCount))) { record in
                        HStack(spacing: 14) {
                            Image(systemName: record.kind == "drink" ? "drop.fill" : "arrow.clockwise").foregroundStyle(PondStyle.teal).frame(width: 20)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(record.kind == "drink" ? "喝水 \(record.amount) ml" : "補水 \(record.amount) ml").font(.system(size: 13, weight: .medium))
                                Text(record.date, format: .dateTime.month().day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(record.isManual ? "手動" : (record.estimatedTime ? "杯墊 · 接收時間" : "杯墊"))
                                .font(.caption).foregroundStyle(.secondary)
                            if record.isManual {
                                Button { pendingDelete = record } label: { Image(systemName: "trash") }
                                    .buttonStyle(.borderless).help("刪除這筆手動紀錄")
                            }
                        }.padding(.vertical, 13)
                        Divider()
                    }
                    if visibleCount < store.data.records.count { Button("載入更多") { visibleCount += 50 }.padding() }
                }
            }
        }.confirmationDialog("刪除這筆手動紀錄？", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("刪除紀錄", role: .destructive) { if let record = pendingDelete { store.remove(record) }; pendingDelete = nil }
            Button("取消", role: .cancel) { pendingDelete = nil }
        } message: { Text("喝水總量會更新，已計入的釣魚次數與累積進度不會回溯或重複發放。") }
    }
}

struct SettingsView: View {
    @ObservedObject var store: PondStore
    @ObservedObject var bluetooth: BluetoothManager
    @State private var goal = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageHeading("設定與杯墊", subtitle: "讓小池塘，配合你的日常。")
            GroupBox("每日目標") {
                HStack {
                    TextField("每日飲水量", text: $goal).textFieldStyle(.roundedBorder).frame(width: 110)
                    Text("ml").foregroundStyle(.secondary)
                    Button("儲存") { if let value = Int(goal) { store.updateGoal(value) } }
                        .disabled(Int(goal) == nil)
                    Spacer()
                }.padding(12)
            }
            GroupBox("桌面陪伴") {
                Toggle("小池塘保持置頂", isOn: Binding(get: { store.data.pinned }, set: { _ in store.togglePin() }))
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            }
            WeatherSettingsView(store: store)
            GroupBox("智慧杯墊") {
                VStack(alignment: .leading, spacing: 14) {
                    Label(bluetooth.status, systemImage: bluetooth.connected ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
                        .foregroundStyle(bluetooth.connected ? PondStyle.teal : .secondary)
                    if bluetooth.connected || bluetooth.connecting {
                        Button(bluetooth.connecting ? "取消連線" : "中斷並取消自動連線") { bluetooth.disconnect() }
                    } else {
                        Button(bluetooth.scanning ? "停止搜尋" : "搜尋杯墊") {
                            if bluetooth.scanning { bluetooth.stopScan() } else { bluetooth.scan() }
                        }
                        ForEach(bluetooth.devices) { device in
                            HStack { Text(device.name); Spacer(); Button("連接") { bluetooth.connect(device.peripheral) } }
                        }
                    }
                    Text("杯墊可能一次只能連接一台裝置。連線後會自動校時，並補傳仍保存在杯墊上的紀錄。")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("杯墊最多暫存 64 筆事件，斷電後會清空。未校時的事件以接收時間標示；補傳紀錄不另發釣魚獎勵。")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            }
            GroupBox("資料與玩法") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("紀錄與魚兒保存在這台 Mac，不需要帳號。")
                    Text("手動記錄和杯墊偵測都能獲得釣魚機會；同一杯水請選擇一種方式記錄。")
                    Text("每累積 200 ml 獲得一次釣魚機會，每日最多 8 次。未滿 200 ml 的餘量跨日保留，已獲得的機會不過期。")
                    Text("當天領滿 8 次後的額外水量仍會記錄，但不累積釣魚進度。魚種機率與單次喝水量無關。")
                    Button("匯出喝水紀錄", action: store.exportRecords)
                }.font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.onAppear { goal = String(store.data.goal) }
    }
}


struct WeatherSettingsView: View {
    @ObservedObject var store: PondStore
    var body: some View {
        GroupBox("池塘天氣") {
            VStack(alignment: .leading, spacing: 12) {
                Picker("天氣城市", selection: Binding<TaiwanCity?>(get: { store.data.weatherCity }, set: store.selectWeatherCity)) {
                    Text("請選擇城市").tag(TaiwanCity?.none)
                    ForEach(TaiwanCity.allCases) { city in Text(city.name).tag(Optional(city)) }
                }.frame(maxWidth: 320)
                HStack {
                    Label(store.weatherSummary, systemImage: store.currentWeather?.condition.symbol ?? "cloud")
                        .foregroundStyle(PondStyle.teal)
                    Spacer()
                    Button(store.weatherLoading ? "更新中…" : "更新天氣") { store.refreshWeather() }
                        .disabled(store.data.weatherCity == nil || store.weatherLoading)
                }
                Text(store.weatherDetail).font(.caption).foregroundStyle(.secondary)
                if let special = store.currentWeather?.condition.exclusiveFish {
                    Text("現在有機會遇見\(special.name) · 每次收竿 20%")
                        .font(.callout).foregroundStyle(PondStyle.teal)
                }
                Text("每 30 分鐘更新；雨天、雷雨與起霧各有專屬魚兒。取得的魚永久收藏，釣魚機會可以留到喜歡的天氣再用。")
                    .font(.caption).foregroundStyle(.secondary)
                Text("使用縣市代表地點的氣象模型資料，可能與窗外天氣不同。斷線最多沿用 2 小時，過期後仍可釣普通魚。")
                    .font(.caption).foregroundStyle(.secondary)
                Link("天氣資料：Open-Meteo · CC BY 4.0", destination: URL(string: "https://open-meteo.com/")!)
                    .font(.caption)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
