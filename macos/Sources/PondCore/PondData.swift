import Foundation

public struct WaterRecord: Codable, Identifiable, Equatable {
    public let id: String
    public let date: Date
    public let amount: Int
    public let source: String
    public let kind: String
    public let estimatedTime: Bool
    public var isManual: Bool { source == "manual" }

    public init(id: String = UUID().uuidString, date: Date = Date(), amount: Int,
                source: String = "manual", kind: String = "drink", estimatedTime: Bool = false) {
        self.id = id; self.date = date; self.amount = amount
        self.source = source; self.kind = kind; self.estimatedTime = estimatedTime
    }
}

public enum FishSpecies: String, CaseIterable, Codable, Identifiable {
    case peach, sunshine, mint, blueberry, moon
    public var id: String { rawValue }
    public var name: String {
        switch self {
        case .peach: return "蜜桃小魚"
        case .sunshine: return "日光金魚"
        case .mint: return "薄荷小魚"
        case .blueberry: return "藍莓小魚"
        case .moon: return "月光小魚"
        }
    }
    public var story: String {
        switch self {
        case .peach: return "喜歡在午後的水面上，收集一點點陽光。"
        case .sunshine: return "每次搖搖尾巴，就把池塘照亮一點。"
        case .mint: return "躲在荷葉下，是牠最拿手的捉迷藏。"
        case .blueberry: return "帶著一身湖水的顏色，慢慢游進你的日常。"
        case .moon: return "把月光藏在魚鰭裡，留給晚歸的小貓。"
        }
    }
    public var rarity: String { self == .moon ? "稀有" : (self == .blueberry ? "少見" : "常見") }
    public static func draw(roll: Int) -> FishSpecies {
        switch roll {
        case 0..<32: return .peach
        case 32..<60: return .sunshine
        case 60..<82: return .mint
        case 82..<96: return .blueberry
        default: return .moon
        }
    }
}

public struct CaughtFish: Codable, Identifiable, Equatable {
    public let id: UUID
    public let species: FishSpecies
    public let date: Date
    public init(species: FishSpecies, date: Date = Date()) {
        self.id = UUID(); self.species = species; self.date = date
    }
}

public struct Reward: Codable, Equatable {
    public let recordID: String
    public let date: Date
    public var spent: Bool
}

public struct PondData: Codable, Equatable {
    public static let waterPerTicket = 200
    public static let dailyTicketLimit = 8
    public var version = 2
    public var records: [WaterRecord] = []
    public var fish: [CaughtFish] = []
    public var rewards: [Reward] = []
    public var seenIDs: Set<String> = []
    public var goal = 2000
    public var pinned = true
    public var decoration = "水草"
    public var preferredPeripheral: String?
    public var preferredPeripheralName: String?
    public private(set) var fishingRemainderMl = 0

    public init() {}
    public var tickets: Int { rewards.filter { !$0.spent }.count }
    public var mlToNextTicket: Int { Self.waterPerTicket - fishingRemainderMl }

    private enum CodingKeys: String, CodingKey {
        case version, records, fish, rewards, seenIDs, goal, pinned, decoration
        case preferredPeripheral, preferredPeripheralName, fishingRemainderMl
    }

    public init(from decoder: Decoder) throws {
        self.init()
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let storedVersion = try container.decode(Int.self, forKey: .version)
        guard storedVersion == 1 || storedVersion == 2 else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: container, debugDescription: "Unsupported state version")
        }
        records = try container.decode([WaterRecord].self, forKey: .records)
        fish = try container.decode([CaughtFish].self, forKey: .fish)
        rewards = try container.decode([Reward].self, forKey: .rewards)
        seenIDs = try container.decode(Set<String>.self, forKey: .seenIDs)
        goal = try container.decode(Int.self, forKey: .goal)
        pinned = try container.decode(Bool.self, forKey: .pinned)
        decoration = try container.decode(String.self, forKey: .decoration)
        preferredPeripheral = try container.decodeIfPresent(String.self, forKey: .preferredPeripheral)
        preferredPeripheralName = try container.decodeIfPresent(String.self, forKey: .preferredPeripheralName)
        // V1 awards used a time-based rule. Preserve those tickets, but never re-credit historical intake.
        fishingRemainderMl = storedVersion == 1 ? 0 : try container.decode(Int.self, forKey: .fishingRemainderMl)
        guard (0..<Self.waterPerTicket).contains(fishingRemainderMl) else {
            throw DecodingError.dataCorruptedError(forKey: .fishingRemainderMl, in: container, debugDescription: "Invalid fishing remainder")
        }
    }

    public func rewardsGranted(on date: Date, calendar: Calendar = .current) -> Int {
        rewards.filter { calendar.isDate($0.date, inSameDayAs: date) }.count
    }

    public func total(on date: Date, calendar: Calendar = .current) -> Int {
        records.filter { $0.kind == "drink" && calendar.isDate($0.date, inSameDayAs: date) }
            .reduce(0) { $0 + $1.amount }
    }

    /// Each 200 ml of eligible intake mints one ticket. Partial progress carries across days.
    /// Once the daily cap is reached, surplus intake is recorded without banking extra rewards.
    @discardableResult
    public mutating func add(_ record: WaterRecord, now: Date = Date(),
                             rewardEligible: Bool = true, calendar: Calendar = .current) -> Bool {
        guard (1...5000).contains(record.amount), ["drink", "refill"].contains(record.kind),
              !seenIDs.contains(record.id) else { return false }
        seenIDs.insert(record.id)
        records.append(record)
        records.sort { $0.date > $1.date }
        guard record.kind == "drink", rewardEligible,
              calendar.isDate(record.date, inSameDayAs: now) else { return true }
        let slots = max(0, Self.dailyTicketLimit - rewardsGranted(on: now, calendar: calendar))
        guard slots > 0 else { return true }
        let volume = fishingRemainderMl + record.amount
        let awarded = min(volume / Self.waterPerTicket, slots)
        for _ in 0..<awarded {
            rewards.append(Reward(recordID: record.id, date: now, spent: false))
        }
        fishingRemainderMl = awarded == slots ? 0 : volume % Self.waterPerTicket
        return true
    }

    public mutating func removeManual(id: String) {
        // Corrections affect the water log, not previously credited game progress or deduplication.
        records.removeAll { $0.id == id && $0.isManual }
    }

    @discardableResult
    public mutating func catchFish(roll: Int = Int.random(in: 0..<100), now: Date = Date()) -> CaughtFish? {
        guard let index = rewards.firstIndex(where: { !$0.spent }) else { return nil }
        rewards[index].spent = true
        let caught = CaughtFish(species: FishSpecies.draw(roll: roll), date: now)
        fish.append(caught)
        return caught
    }
}

public struct DeviceEvent: Decodable {
    public let eventId: String
    public let occurredAt: Double
    public let type: String
    public let amountMl: Int
    public let timeSynced: Bool?

    public func record(peripheralID: String, receivedAt: Date = Date()) -> WaterRecord? {
        guard !eventId.isEmpty, ["drink", "refill"].contains(type),
              (1...5000).contains(amountMl), occurredAt.isFinite else { return nil }
        let estimated = timeSynced == false || occurredAt < 1_600_000_000
        let date = estimated ? receivedAt : Date(timeIntervalSince1970: occurredAt)
        guard date <= receivedAt.addingTimeInterval(300) else { return nil }
        return WaterRecord(id: peripheralID + ":" + eventId, date: date, amount: amountMl,
                           source: peripheralID, kind: type, estimatedTime: estimated)
    }
}

public enum PondPersistence {
    public static func load(from url: URL) throws -> PondData {
        guard FileManager.default.fileExists(atPath: url.path) else { return PondData() }
        let result = try JSONDecoder().decode(PondData.self, from: Data(contentsOf: url))
        guard result.version == 2 else { throw CocoaError(.fileReadCorruptFile) }
        return result
    }
    public static func save(_ state: PondData, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: url.path) {
            let previous = try Data(contentsOf: url)
            if let object = try? JSONSerialization.jsonObject(with: previous) as? [String: Any],
               object["version"] as? Int == 1 {
                let backup = url.deletingLastPathComponent().appendingPathComponent("state-v1-backup.json")
                if !FileManager.default.fileExists(atPath: backup.path) {
                    try previous.write(to: backup, options: .atomic)
                }
            }
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(state).write(to: url, options: .atomic)
    }
}
