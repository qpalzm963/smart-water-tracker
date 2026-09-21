import CoreBluetooth
import Foundation
import PondCore

struct NearbyCoaster: Identifiable {
    let peripheral: CBPeripheral
    let name: String
    var id: UUID { peripheral.identifier }
}

/// The peripheral only retains 64 events in RAM. Replay all available events,
/// then deduplicate against the persisted ledger to avoid cursor/live-event races.
@MainActor
final class BluetoothManager: NSObject, ObservableObject, @preconcurrency CBCentralManagerDelegate, @preconcurrency CBPeripheralDelegate {
    static let service = CBUUID(string: "7d5a0001-2d5c-4d2f-9f85-7d7bf8a9a101")
    static let live = CBUUID(string: "7d5a0002-2d5c-4d2f-9f85-7d7bf8a9a101")
    static let summary = CBUUID(string: "7d5a0003-2d5c-4d2f-9f85-7d7bf8a9a101")
    static let history = CBUUID(string: "7d5a0004-2d5c-4d2f-9f85-7d7bf8a9a101")
    static let command = CBUUID(string: "7d5a0005-2d5c-4d2f-9f85-7d7bf8a9a101")

    @Published var status = "尚未連接杯墊"
    @Published var devices: [NearbyCoaster] = []
    @Published var scanning = false
    @Published var connected = false
    @Published var connecting = false
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var characteristics: [CBUUID: CBCharacteristic] = [:]
    private var readyNotifications: Set<CBUUID> = []
    private var summaryReceived = false
    private var syncRequested = false
    private var malformedData = false
    private var wantsScan = false
    private var autoConnect = true
    private var timeout: Task<Void, Never>?
    private weak var store: PondStore?

    init(store: PondStore) { self.store = store; super.init() }

    func restoreIfNeeded() {
        if store?.data.preferredPeripheral != nil { start() }
    }
    private func start() {
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
        else if central?.state == .poweredOn { resume() }
    }
    func scan() {
        wantsScan = true; autoConnect = false
        devices = []; start()
    }
    private func resume() {
        guard let central, central.state == .poweredOn else { return }
        if wantsScan {
            guard !scanning else { return }
            status = "正在尋找附近的杯墊…"; scanning = true
            central.scanForPeripherals(withServices: [Self.service])
            timeout?.cancel()
            timeout = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(12))
                guard !Task.isCancelled, let self else { return }
                self.stopScan()
                self.status = self.devices.isEmpty ? "沒有找到杯墊，請確認電源與距離" : "請選擇要連接的杯墊"
            }
        } else if autoConnect, peripheral == nil,
                  let saved = store?.data.preferredPeripheral, let id = UUID(uuidString: saved),
                  let device = central.retrievePeripherals(withIdentifiers: [id]).first {
            connect(device)
        }
    }
    func stopScan() {
        central?.stopScan(); timeout?.cancel()
        if scanning { status = "搜尋已結束" }
        scanning = false; wantsScan = false
    }
    func connect(_ device: CBPeripheral) {
        guard peripheral == nil else { return }
        stopScan(); timeout?.cancel(); autoConnect = true
        peripheral = device; device.delegate = self
        characteristics = [:]; readyNotifications = []; summaryReceived = false; syncRequested = false; malformedData = false
        connecting = true; status = "正在連接 \(device.name ?? "杯墊")…"
        central?.connect(device)
        timeout = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(18))
            guard !Task.isCancelled, let self, !self.connected else { return }
            self.disconnect(forget: false)
            self.status = "連線逾時，請確認杯墊未被其他裝置占用"
        }
    }
    func disconnect(forget: Bool = true) {
        autoConnect = false; stopScan(); timeout?.cancel()
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        peripheral = nil; connected = false; connecting = false
        characteristics = [:]; status = "尚未連接杯墊"
        if forget { store?.rememberDevice(id: nil) }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: resume()
        case .unauthorized: status = "請在系統設定 → 隱私權與安全性 → 藍牙，允許小貓釣魚"
        case .poweredOff: status = "Mac 藍牙已關閉"
        case .unsupported: status = "這台 Mac 不支援藍牙低功耗"
        default: status = "正在準備藍牙…"
        }
        if central.state != .poweredOn {
            timeout?.cancel()
            connected = false; connecting = false; scanning = false; peripheral = nil
        }
    }
    func centralManager(_ central: CBCentralManager, didDiscover device: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        if !devices.contains(where: { $0.id == device.identifier }) {
            devices.append(NearbyCoaster(peripheral: device, name: device.name ?? "WaterTracker"))
        }
    }
    func centralManager(_ central: CBCentralManager, didConnect device: CBPeripheral) {
        guard device == peripheral else { return }
        status = "正在同步杯墊…"; device.discoverServices([Self.service])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect device: CBPeripheral, error: Error?) {
        guard device == peripheral else { return }
        timeout?.cancel(); peripheral = nil; connecting = false; connected = false
        status = "連線失敗，請重試"
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral device: CBPeripheral, error: Error?) {
        guard device == peripheral else { return }
        peripheral = nil; connected = false; connecting = false
        status = "杯墊已離線，仍可手動記錄"
        if autoConnect {
            timeout?.cancel()
            timeout = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled, let self, self.autoConnect else { return }
                self.resume()
            }
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral == self.peripheral else { return }
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == Self.service }) else {
            fail("找不到杯墊服務"); return
        }
        peripheral.discoverCharacteristics([Self.live, Self.summary, Self.history, Self.command], for: service)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral == self.peripheral else { return }
        guard error == nil else { fail("無法讀取杯墊服務"); return }
        for characteristic in service.characteristics ?? [] { characteristics[characteristic.uuid] = characteristic }
        guard let live = characteristics[Self.live], let history = characteristics[Self.history],
              let summary = characteristics[Self.summary], let command = characteristics[Self.command] else {
            fail("杯墊韌體不支援必要功能"); return
        }
        peripheral.setNotifyValue(true, for: live)
        peripheral.setNotifyValue(true, for: history)
        peripheral.readValue(for: summary)
        let request: [String: Any] = ["action": "set_time", "epoch": Int(Date().timeIntervalSince1970),
                                     "tzOffsetMinutes": TimeZone.current.secondsFromGMT() / 60]
        if let bytes = try? JSONSerialization.data(withJSONObject: request) {
            peripheral.writeValue(bytes, for: command, type: .withResponse)
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral == self.peripheral else { return }
        guard error == nil, characteristic.isNotifying else { fail("無法訂閱杯墊通知"); return }
        readyNotifications.insert(characteristic.uuid); syncIfReady()
    }
    private func syncIfReady() {
        guard !syncRequested, summaryReceived, readyNotifications.contains(Self.live),
              readyNotifications.contains(Self.history), let peripheral,
              let history = characteristics[Self.history] else { return }
        syncRequested = true
        peripheral.writeValue(Data("{\"afterEventId\":\"\"}".utf8), for: history, type: .withResponse)
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral == self.peripheral else { return }
        if error != nil { fail("杯墊同步命令失敗，請重新連線") }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral == self.peripheral else { return }
        guard error == nil, let bytes = characteristic.value else { fail("杯墊資料讀取失敗"); return }
        if characteristic.uuid == Self.summary {
            guard let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  object["deviceId"] is String else { fail("杯墊資料不完整，請重新連線"); return }
            summaryReceived = true; syncIfReady(); return
        }
        if characteristic.uuid == Self.history,
           let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
           object["syncComplete"] as? Bool == true {
            timeout?.cancel(); connected = true; connecting = false
            status = malformedData ? "已連接，但有不完整資料，請重新連線補傳" : "\(peripheral.name ?? "杯墊") · 已連接"
            store?.rememberDevice(id: peripheral.identifier.uuidString, name: peripheral.name)
            return
        }
        guard let event = try? JSONDecoder().decode(DeviceEvent.self, from: bytes) else {
            malformedData = true
            status = "收到不完整資料，請重新連線補傳"; return
        }
        store?.receive(event, peripheralID: peripheral.identifier.uuidString, replay: characteristic.uuid == Self.history)
    }
    private func fail(_ message: String) {
        disconnect(forget: false); status = message
    }
}
