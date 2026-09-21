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
    private var hydrationTask: Task<Void, Never>?
    private var storageUnavailable = false
    private let file: URL
    private var clock: AnyCancellable?
    private var toastTask: Task<Void, Never>?
    var showPond: (() -> Void)?
    var hidePond: (() -> Void)?
    var openDetails: ((String) -> Void)?
    var setPinned: ((Bool) -> Void)?

    init(file: URL? = nil) {
        let override = ProcessInfo.processInfo.environment["CATPOND_DATA_DIR"].map { URL(fileURLWithPath: $0).appendingPathComponent("state.json") }
        self.file = file ?? override ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CatPond/state.json")
        do { data = try PondPersistence.load(from: self.file) }
        catch {
            data = PondData()
            storageUnavailable = true
            self.error = "無法讀取既有紀錄，已停止寫入以保留原檔。請備份並檢查 \(self.file.path)"
        }
        clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect().sink { [weak self] in self?.now = $0 }
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
        guard commit({ result = $0.catchFish() }), let result else { return }
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
    func updateGoal(_ value: Int) {
        guard (100...10000).contains(value) else { error = "目標請填寫 100～10000 ml。"; return }
        _ = commit { $0.goal = value }
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
