import AppKit
import Combine
import PondCore

@MainActor
final class PondStore: ObservableObject {
    @Published private(set) var data: PondData
    @Published var now = Date()
    @Published var toast: String?
    @Published var caught: CaughtFish?
    @Published private(set) var isReeling = false
    @Published private(set) var reelStartedAt: Date?
    @Published private(set) var pendingCatch: CaughtFish?
    @Published var error: String?
    @Published private(set) var hydrationAmount = 0
    @Published private(set) var hydrationTrigger = UUID()
    @Published var pondVisible = true {
        didSet { if !pondVisible { clearHydrationFeedback() } }
    }
    @Published private(set) var weatherSnapshot: WeatherSnapshot?
    @Published private(set) var weatherLoading = false
    @Published private(set) var weatherFailed = false
    private let weatherClient: any WeatherFetching
    private var weatherTask: Task<Void, Never>?
    private var weatherRequestID = UUID()
    private var lastWeatherAttempt: Date?
    private var weatherUpdatesStarted = false
    private var wakeObserver: AnyCancellable?
    private var hydrationTask: Task<Void, Never>?
    private var storageUnavailable = false
    private let file: URL
    private var clock: AnyCancellable?
    private var toastTask: Task<Void, Never>?
    var showPond: (() -> Void)?
    var hidePond: (() -> Void)?
    var openDetails: ((String) -> Void)?
    var setPinned: ((Bool) -> Void)?

    init(file: URL? = nil, weatherClient: any WeatherFetching = OpenMeteoClient()) {
        self.weatherClient = weatherClient
        let override = ProcessInfo.processInfo.environment["CATPOND_DATA_DIR"].map { URL(fileURLWithPath: $0).appendingPathComponent("state.json") }
        self.file = file ?? override ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CatPond/state.json")
        do { data = try PondPersistence.load(from: self.file) }
        catch {
            data = PondData()
            storageUnavailable = true
            self.error = "無法讀取既有紀錄，已停止寫入以保留原檔。請備份並檢查 \(self.file.path)"
        }
        weatherSnapshot = data.weatherCache
        clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect().sink { [weak self] date in
            self?.now = date
            self?.refreshWeatherIfNeeded(at: date)
        }
    }

    var currentWeather: WeatherSnapshot? { validWeather(at: now) }
    func validWeather(at date: Date) -> WeatherSnapshot? {
        weatherSnapshot.flatMap { $0.isUsable(for: data.weatherCity, at: date) ? $0 : nil }
    }
    var weatherSummary: String {
        guard let city = data.weatherCity else { return "選擇天氣城市" }
        guard let weather = currentWeather else {
            return city.name + (weatherLoading ? " · 更新天氣中" : " · 天氣暫時無法更新")
        }
        return "\(city.name) · \(weather.condition.name) · \(Int(weather.temperature.rounded()))°"
    }
    var weatherDetail: String {
        guard data.weatherCity != nil else { return "選擇城市，讓池塘跟隨當地天氣。" }
        guard let cached = weatherSnapshot, cached.city == data.weatherCity else {
            return weatherLoading ? "正在取得天氣，暫時使用普通魚池。" : "尚無天氣資料，仍可釣到普通魚。"
        }
        let updated = cached.fetchedAt.formatted(date: .abbreviated, time: .shortened)
        if currentWeather == nil { return "上次更新 \(updated) · 資料已過期，暫時使用普通魚池。" }
        return "更新於 \(updated)" + (weatherFailed ? " · 連線失敗，暫用最近資料" : "")
    }
    func startWeatherUpdates() {
        guard !weatherUpdatesStarted else { return }
        weatherUpdatesStarted = true
        refreshWeatherIfNeeded(at: Date())
        wakeObserver = NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in
                self?.now = Date()
                self?.refreshWeatherIfNeeded(at: Date())
            }
    }
    func selectWeatherCity(_ city: TaiwanCity?) {
        guard city != data.weatherCity else { return }
        guard commit({ $0.weatherCity = city; $0.weatherCache = nil }) else { return }
        weatherTask?.cancel()
        weatherRequestID = UUID()
        weatherTask = nil
        weatherLoading = false
        weatherFailed = false
        weatherSnapshot = nil
        lastWeatherAttempt = nil
        refreshWeather()
    }
    func refreshWeatherIfNeeded(at date: Date) {
        guard weatherUpdatesStarted, data.weatherCity != nil, !weatherLoading else { return }
        let last = lastWeatherAttempt ?? weatherSnapshot?.fetchedAt ?? .distantPast
        let interval: TimeInterval = weatherFailed ? 300 : 1800
        if date.timeIntervalSince(last) >= interval || date < last { refreshWeather() }
    }
    func refreshWeather() {
        guard let city = data.weatherCity, !weatherLoading else { return }
        let requestID = UUID()
        weatherRequestID = requestID
        weatherLoading = true
        lastWeatherAttempt = Date()
        let client = weatherClient
        weatherTask = Task { @MainActor [weak self] in
            do {
                let snapshot = try await client.fetch(city: city)
                guard let self, !Task.isCancelled, self.weatherRequestID == requestID,
                      self.data.weatherCity == city else { return }
                guard snapshot.isUsable(for: city, at: Date()) else { throw URLError(.cannotParseResponse) }
                self.now = Date()
                self.weatherSnapshot = snapshot
                self.weatherFailed = false
                self.commit { $0.weatherCache = snapshot }
            } catch {
                guard let self, !Task.isCancelled, self.weatherRequestID == requestID else { return }
                self.now = Date()
                self.weatherFailed = true
            }
            guard let self, self.weatherRequestID == requestID else { return }
            self.weatherLoading = false
            self.weatherTask = nil
        }
    }

    var total: Int { data.total(on: now) }
    var progress: Double { min(Double(total) / Double(max(data.goal, 1)), 1) }
    var todayRecords: [WaterRecord] { data.records.filter { Calendar.current.isDate($0.date, inSameDayAs: now) } }
    var fishingProgressText: String {
        if data.rewardsGranted(on: now) >= PondData.dailyTicketLimit {
            return "今日已獲得 8 次，明天再累積；已獲得的次數可隨時使用"
        }
        return "距離下一次釣魚還差 \(data.mlToNextTicket) ml · 已累積 \(data.fishingRemainderMl) / 200 ml"
    }

    @discardableResult
    private func commit(_ change: (inout PondData) -> Void) -> Bool {
        guard !storageUnavailable else { return false }
        var next = data
        change(&next)
        do {
            try PondPersistence.save(next, to: file)
            data = next
            error = nil
            return true
        } catch {
            self.error = "紀錄未儲存：\(error.localizedDescription)。請確認磁碟空間後重試。"
            return false
        }
    }

    @discardableResult
    func log(amount: Int) -> Bool {
        guard (1...5000).contains(amount) else { error = "請輸入 1～5000 ml 的整數。"; return false }
        now = Date()
        let oldTickets = data.tickets
        guard commit({ $0.add(WaterRecord(amount: amount), now: now) }) else { return false }
        showHydrationFeedback(amount: amount)
        let earned = data.tickets - oldTickets
        announce("＋\(amount) ml" + (earned > 0 ? " · 獲得 \(earned) 次釣魚機會" : " · 已記錄"))
        return true
    }

    func receive(_ event: DeviceEvent, peripheralID: String, replay: Bool) {
        now = Date()
        guard let record = event.record(peripheralID: peripheralID, receivedAt: now),
              !data.seenIDs.contains(record.id) else { return }
        let oldTickets = data.tickets
        guard commit({ $0.add(record, now: now, rewardEligible: !replay) }) else { return }
        if !replay && record.kind == "drink" {
            showHydrationFeedback(amount: record.amount)
            let earned = data.tickets - oldTickets
            announce("＋\(record.amount) ml" + (earned > 0 ? " · 獲得 \(earned) 次釣魚機會" : " · 已記錄"))
        }
    }

    private func showHydrationFeedback(amount: Int) {
        guard pondVisible, !isReeling, caught == nil else { return }
        hydrationTask?.cancel()
        hydrationAmount += amount
        hydrationTrigger = UUID()
        hydrationTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            self?.hydrationAmount = 0
        }
    }

    private func clearHydrationFeedback() {
        hydrationTask?.cancel()
        hydrationTask = nil
        hydrationAmount = 0
    }

    func reel(reduceMotion: Bool = false) {
        guard !isReeling, caught == nil, data.tickets > 0 else { return }
        var result: CaughtFish?
        now = Date()
        let weather = validWeather(at: now)
        guard commit({ result = $0.catchFish(now: now, weather: weather) }), let result else { return }
        clearHydrationFeedback()
        pendingCatch = result
        reelStartedAt = Date()
        if reduceMotion || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            caught = result
            return
        }
        isReeling = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(FishingMotion.duration))
            self?.caught = result
            self?.isReeling = false
        }
    }

    func dismissCatch() {
        caught = nil
        pendingCatch = nil
        reelStartedAt = nil
    }

    func announce(_ text: String) {
        toastTask?.cancel()
        toast = text
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
    func remove(_ record: WaterRecord) { _ = commit { $0.removeManual(id: record.id) } }
    @discardableResult
    func updateGoal(_ value: Int) -> Bool {
        guard (100...10000).contains(value) else { error = "目標請填寫 100～10000 ml。"; return false }
        return commit { $0.goal = value }
    }
    func togglePin() {
        if commit({ $0.pinned.toggle() }) { setPinned?(data.pinned) }
    }
    func decorate(_ value: String) { _ = commit { $0.decoration = value } }
    func rememberDevice(id: String?, name: String? = nil) {
        _ = commit { $0.preferredPeripheral = id; $0.preferredPeripheralName = name }
    }
    func exportRecords() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "喝水紀錄.json"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(data.records).write(to: url, options: .atomic)
        } catch { self.error = "匯出失敗：\(error.localizedDescription)" }
    }
}
