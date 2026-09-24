import SwiftUI
import PondCore

struct SettingsView: View {
    @ObservedObject var store: PondStore
    @ObservedObject var bluetooth: BluetoothManager
    @Binding var goal: String
    @State private var savedGoal: Int?
    private var validGoal: Int? { PondInput.amount(goal, range: 100...10000) }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            PageHeader(title: "設定與杯墊", subtitle: "讓小池塘配合你的日常。", eyebrow: "自己的步調")
            PondCard {
                VStack(alignment: .leading, spacing: 20) {
                    SectionTitle(title: "日常偏好")
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("每日喝水目標").font(.system(size: 13, weight: .medium))
                            Text("100～10000 ml").font(.system(size: 11)).foregroundStyle(PondStyle.muted)
                        }
                        Spacer()
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) {
                                TextField("每日目標", text: $goal).textFieldStyle(.roundedBorder).frame(width: 90)
                                    .accessibilityLabel("每日喝水目標，毫升").onSubmit(saveGoal)
                                Text("ml").font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                                Button("儲存", action: saveGoal).buttonStyle(.borderedProminent)
                                    .disabled(validGoal == nil || validGoal == store.data.goal)
                            }
                            if !goal.isEmpty && validGoal == nil {
                                Label("請輸入範圍內的整數", systemImage: "exclamationmark.circle")
                                    .font(.system(size: 11)).foregroundStyle(.red)
                            } else if let savedGoal, savedGoal == validGoal {
                                Label("目標已儲存", systemImage: "checkmark.circle.fill").font(.system(size: 11)).foregroundStyle(PondStyle.teal)
                            }
                        }
                    }
                    Divider()
                    Toggle(isOn: Binding(get: { store.data.pinned }, set: { _ in store.togglePin() })) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("小池塘保持置頂").font(.system(size: 13, weight: .medium))
                            Text("使用其他 App 時，也能看見小貓。")
                                .font(.system(size: 11)).foregroundStyle(PondStyle.muted)
                        }
                    }.toggleStyle(.switch).accessibilityLabel("小池塘保持置頂")
                }
            }
            WeatherSettingsView(store: store)
            PondCard {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        SectionTitle(title: "智慧杯墊")
                        Spacer()
                        InfoPill(text: bluetooth.connected ? "已連線" : bluetooth.connecting ? "連線中" : bluetooth.scanning ? "搜尋中" : "未連線",
                                 symbol: bluetooth.connected ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
                    }
                    Text(bluetooth.status).font(.system(size: 13)).foregroundStyle(PondStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if bluetooth.connected || bluetooth.connecting {
                        Button(bluetooth.connecting ? "取消連線" : "中斷並取消自動連線") { bluetooth.disconnect() }
                            .buttonStyle(.bordered).controlSize(.large)
                    } else {
                        HStack(spacing: 12) {
                            Button(bluetooth.scanning ? "停止搜尋" : "搜尋杯墊") {
                                if bluetooth.scanning { bluetooth.stopScan() } else { bluetooth.scan() }
                            }.buttonStyle(.bordered).controlSize(.large)
                            if bluetooth.scanning { ProgressView().controlSize(.small) }
                        }
                        ForEach(bluetooth.devices) { device in
                            HStack {
                                Label(device.name, systemImage: "antenna.radiowaves.left.and.right")
                                Spacer()
                                Button("連接") { bluetooth.connect(device.peripheral) }.buttonStyle(.bordered)
                            }.font(.system(size: 13)).padding(12).background(PondStyle.teal.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    Text("同一杯水請選擇手動或杯墊記錄，避免重複計算。")
                        .font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                    DisclosureGroup("連線與補傳說明") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("杯墊可能一次只能連接一台裝置。連線後會自動校時，並補傳仍保存在杯墊上的紀錄。")
                            Text("杯墊最多暫存 64 筆事件，斷電後會清空。未校時的事件以接收時間標示；補傳紀錄不另發釣魚獎勵。")
                        }.font(.system(size: 12)).foregroundStyle(PondStyle.muted).padding(.top, 8)
                    }.font(.system(size: 12))
                }
            }
            PondCard {
                VStack(alignment: .leading, spacing: 16) {
                    SectionTitle(title: "資料保存", subtitle: "紀錄與魚兒保存在這台 Mac，不需要帳號。")
                    Button { store.exportRecords() } label: { Label("匯出喝水紀錄", systemImage: "square.and.arrow.up") }
                        .buttonStyle(.bordered).controlSize(.large)
                    Text("匯出 JSON 包含喝水紀錄，不包含魚兒收藏與設定。")
                        .font(.system(size: 12)).foregroundStyle(PondStyle.muted)
                    Divider()
                    DisclosureGroup("釣魚機會怎麼累積？") {
                        VStack(alignment: .leading, spacing: 9) {
                            Text("手動記錄和杯墊即時偵測，每累積 200 ml 獲得一次釣魚機會，每日最多 8 次。")
                            Text("未滿 200 ml 的餘量跨日保留，已獲得的機會不過期。當天領滿 8 次後的水量仍會記錄，但不累積釣魚進度。")
                            Text("魚種機率與單次喝水量無關。刪除手動紀錄不會收回已獲得的機會。")
                        }.font(.system(size: 12)).foregroundStyle(PondStyle.muted).padding(.top, 8)
                    }.font(.system(size: 12))
                }
            }
        }.onAppear { if goal.isEmpty { goal = String(store.data.goal) } }
    }
    private func saveGoal() {
        guard let validGoal, validGoal != store.data.goal else { return }
        if store.updateGoal(validGoal) { savedGoal = validGoal }
    }
}

struct WeatherSettingsView: View {
    @ObservedObject var store: PondStore
    var body: some View {
        PondCard {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    SectionTitle(title: "池塘天氣")
                    Spacer()
                    Image(systemName: store.currentWeather?.condition.symbol ?? "cloud.sun")
                        .font(.system(size: 26, weight: .light)).foregroundStyle(PondStyle.teal)
                }
                Picker("天氣城市", selection: Binding<TaiwanCity?>(get: { store.data.weatherCity }, set: store.selectWeatherCity)) {
                    Text("請選擇城市").tag(TaiwanCity?.none)
                    ForEach(TaiwanCity.allCases) { city in Text(city.name).tag(Optional(city)) }
                }.frame(maxWidth: 320).font(.system(size: 13))
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(store.weatherSummary).font(.system(size: 15, weight: .medium)).foregroundStyle(PondStyle.teal)
                        Text(store.weatherDetail).font(.system(size: 11)).foregroundStyle(PondStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Button(store.weatherLoading ? "更新中…" : "更新天氣") { store.refreshWeather() }
                        .buttonStyle(.bordered).disabled(store.data.weatherCity == nil || store.weatherLoading)
                }
                if let special = store.currentWeather?.condition.exclusiveFish {
                    Label("現在有機會遇見\(special.name) · 每次收竿 20%", systemImage: "fish")
                        .font(.system(size: 12)).foregroundStyle(PondStyle.teal)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(PondStyle.teal.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
                }
                DisclosureGroup("天氣與限定魚說明") {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("每 30 分鐘更新；雨天、雷雨與起霧各有專屬魚兒。魚兒永久收藏，釣魚機會可以留到喜歡的天氣再用。")
                        Text("使用縣市代表地點的氣象模型資料，可能與窗外天氣不同。斷線最多沿用 2 小時，過期後仍可釣普通魚。")
                        Link("天氣資料：Open-Meteo · CC BY 4.0", destination: URL(string: "https://open-meteo.com/")!)
                    }.font(.system(size: 12)).foregroundStyle(PondStyle.muted).padding(.top, 8)
                }.font(.system(size: 12))
            }
        }
    }
}
