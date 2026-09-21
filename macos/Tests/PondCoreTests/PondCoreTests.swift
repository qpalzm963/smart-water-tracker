import XCTest
@testable import PondCore

final class PondCoreTests: XCTestCase {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        return calendar
    }
    let day = ISO8601DateFormatter().date(from: "2026-09-20T00:00:00Z")!

    func testLiveAndReplayAreIdempotentAcrossRestart() throws {
        var state = PondData()
        let record = WaterRecord(id: "cup:boot-1", date: day, amount: 120, source: "cup")
        XCTAssertTrue(state.add(record, now: day, calendar: calendar))
        let url = temporaryFile()
        try PondPersistence.save(state, to: url)
        var reloaded = try PondPersistence.load(from: url)
        XCTAssertFalse(reloaded.add(record, now: day, rewardEligible: false, calendar: calendar))
        XCTAssertEqual(reloaded.total(on: day, calendar: calendar), 120)
        XCTAssertEqual(reloaded.tickets, 0)
        XCTAssertEqual(reloaded.fishingRemainderMl, 120)
    }
    func testVolumeRewardsAndCapDoNotDiscardWater() {
        var state = PondData()
        for i in 0..<20 {
            let time = day.addingTimeInterval(Double(i) * 15 * 60)
            state.add(WaterRecord(date: time, amount: 100), now: time, calendar: calendar)
        }
        XCTAssertEqual(state.tickets, 8)
        XCTAssertEqual(state.total(on: day, calendar: calendar), 2000)
        XCTAssertEqual(state.records.count, 20)
        XCTAssertEqual(state.fishingRemainderMl, 0)
    }
    func testRefillsAndReplayNeverAwardFishOrIncreaseIntake() {
        var state = PondData()
        state.add(WaterRecord(date: day, amount: 600, source: "cup", kind: "refill"), now: day, calendar: calendar)
        state.add(WaterRecord(date: day, amount: 100, source: "cup"), now: day, rewardEligible: false, calendar: calendar)
        XCTAssertEqual(state.total(on: day, calendar: calendar), 100)
        XCTAssertEqual(state.tickets, 0)
        XCTAssertEqual(state.records.count, 2)
        XCTAssertEqual(state.fishingRemainderMl, 0)
    }
    func testMidnightRolloverAndTicketsPersist() {
        var state = PondData()
        let before = ISO8601DateFormatter().date(from: "2026-09-20T15:50:00Z")!
        let after = ISO8601DateFormatter().date(from: "2026-09-20T16:05:00Z")!
        state.add(WaterRecord(date: before, amount: 120), now: before, calendar: calendar)
        state.add(WaterRecord(date: after, amount: 200), now: after, calendar: calendar)
        XCTAssertEqual(state.total(on: after, calendar: calendar), 200)
        XCTAssertEqual(state.total(on: before, calendar: calendar), 120)
        XCTAssertEqual(state.tickets, 1)
        XCTAssertEqual(state.fishingRemainderMl, 120)
        let later = after.addingTimeInterval(30 * 60)
        state.add(WaterRecord(date: later, amount: 100), now: later, calendar: calendar)
        XCTAssertEqual(state.tickets, 2)
        XCTAssertEqual(state.fishingRemainderMl, 20)
    }
    func testDeletingManualRecordCannotFarmRewardsAndCannotDeleteDeviceData() {
        var state = PondData()
        let manual = WaterRecord(date: day, amount: 100)
        let device = WaterRecord(date: day, amount: 120, source: "cup")
        state.add(manual, now: day, calendar: calendar)
        state.add(device, now: day, calendar: calendar)
        state.removeManual(id: manual.id)
        state.removeManual(id: device.id)
        XCTAssertEqual(state.records, [device])
        XCTAssertFalse(state.add(manual, now: day, calendar: calendar))
        state.add(WaterRecord(date: day, amount: 100), now: day, calendar: calendar)
        XCTAssertEqual(state.tickets, 1)
    }
    func testCatchConsumesExactlyOneTicketAndSurvivesRestart() throws {
        var state = PondData()
        XCTAssertNil(state.catchFish())
        state.add(WaterRecord(date: day, amount: 200), now: day, calendar: calendar)
        let caught = state.catchFish(roll: 99, now: day)
        XCTAssertEqual(caught?.species, .moon)
        XCTAssertEqual(state.tickets, 0)
        XCTAssertNil(state.catchFish())
        let url = temporaryFile()
        try PondPersistence.save(state, to: url)
        let restored = try PondPersistence.load(from: url)
        XCTAssertEqual(restored.fish.count, 1)
        XCTAssertEqual(restored.tickets, 0)
        XCTAssertEqual(restored, state)
    }
    func testUnknownDeviceClockUsesExplicitlyEstimatedReceiptTime() throws {
        let json = #"{"eventId":"cup-0-boot-1","occurredAt":0,"type":"drink","amountMl":120,"timeSynced":false}"#
        let event = try JSONDecoder().decode(DeviceEvent.self, from: Data(json.utf8))
        let record = try XCTUnwrap(event.record(peripheralID: "cup", receivedAt: day))
        XCTAssertEqual(record.date, day)
        XCTAssertTrue(record.estimatedTime)
        XCTAssertEqual(record.id, "cup:cup-0-boot-1")
    }
    func testInvalidAndFutureDeviceEventsAreRejected() throws {
        for values in [("drink", 0, day.timeIntervalSince1970), ("drink", 5001, day.timeIntervalSince1970),
                       ("unknown", 100, day.timeIntervalSince1970), ("drink", 100, day.timeIntervalSince1970 + 1000)] {
            let bytes = try JSONSerialization.data(withJSONObject: ["eventId": "event", "occurredAt": values.2,
                                                                     "type": values.0, "amountMl": values.1, "timeSynced": true])
            XCTAssertNil(try JSONDecoder().decode(DeviceEvent.self, from: bytes).record(peripheralID: "cup", receivedAt: day))
        }
    }
    func testCorruptOrNewerVersionDataIsNeverSilentlyReset() throws {
        let url = temporaryFile()
        try Data("broken".utf8).write(to: url)
        XCTAssertThrowsError(try PondPersistence.load(from: url))
        var state = PondData(); state.version = 100
        try PondPersistence.save(state, to: url)
        XCTAssertThrowsError(try PondPersistence.load(from: url))
    }
    func testDifferentDevicesCannotCollideAndOldEventsDoNotMintTickets() {
        var state = PondData()
        let old = day.addingTimeInterval(-86400)
        state.add(WaterRecord(id: "cupA:1", date: old, amount: 150, source: "cupA"), now: day, calendar: calendar)
        state.add(WaterRecord(id: "cupB:1", date: old, amount: 150, source: "cupB"), now: day, calendar: calendar)
        XCTAssertEqual(state.records.count, 2)
        XCTAssertEqual(state.tickets, 0)
    }
    func testOneDrinkCanAwardMultipleTicketsAndHasNoTimeCooldown() {
        var state = PondData()
        state.add(WaterRecord(date: day, amount: 450), now: day, calendar: calendar)
        XCTAssertEqual(state.tickets, 2)
        XCTAssertEqual(state.fishingRemainderMl, 50)
        XCTAssertEqual(state.mlToNextTicket, 150)
        state.add(WaterRecord(date: day, amount: 150), now: day, calendar: calendar)
        XCTAssertEqual(state.tickets, 3)
        XCTAssertEqual(state.fishingRemainderMl, 0)
    }
    func testRemainderSurvivesRestartAndMidnight() throws {
        var state = PondData()
        state.add(WaterRecord(date: day, amount: 150), now: day, calendar: calendar)
        let url = temporaryFile()
        try PondPersistence.save(state, to: url)
        var restored = try PondPersistence.load(from: url)
        let tomorrow = day.addingTimeInterval(86400)
        restored.add(WaterRecord(date: tomorrow, amount: 50), now: tomorrow, calendar: calendar)
        XCTAssertEqual(restored.tickets, 1)
        XCTAssertEqual(restored.fishingRemainderMl, 0)
        XCTAssertEqual(restored.total(on: tomorrow, calendar: calendar), 50)
        XCTAssertEqual(restored.rewardsGranted(on: day, calendar: calendar), 0)
        XCTAssertEqual(restored.rewardsGranted(on: tomorrow, calendar: calendar), 1)
    }
    func testCapCountsSpentTicketsAndDoesNotBankOverflow() {
        var state = PondData()
        state.add(WaterRecord(date: day, amount: 1800), now: day, calendar: calendar)
        for _ in 0..<8 { XCTAssertNotNil(state.catchFish(now: day)) }
        state.add(WaterRecord(date: day, amount: 150), now: day, calendar: calendar)
        XCTAssertEqual(state.tickets, 0)
        XCTAssertEqual(state.fishingRemainderMl, 0)
        XCTAssertEqual(state.total(on: day, calendar: calendar), 1950)
        let tomorrow = day.addingTimeInterval(86400)
        state.add(WaterRecord(date: tomorrow, amount: 50), now: tomorrow, calendar: calendar)
        XCTAssertEqual(state.tickets, 0)
        XCTAssertEqual(state.fishingRemainderMl, 50)
    }
    func testCapIsIndependentOfHowWaterIsSplitIntoRecords() {
        for amounts in [[1650], [1550, 100], [1550, 50, 50], [800, 800, 50]] {
            var state = PondData()
            for amount in amounts { state.add(WaterRecord(date: day, amount: amount), now: day, calendar: calendar) }
            XCTAssertEqual(state.tickets, 8)
            XCTAssertEqual(state.fishingRemainderMl, 0)
            XCTAssertEqual(state.total(on: day, calendar: calendar), 1650)
        }
    }
    func testManualAndDeviceIntakeCombineButReplayIsNeverCreditedTwice() {
        var state = PondData()
        state.add(WaterRecord(date: day, amount: 100), now: day, calendar: calendar)
        let event = WaterRecord(id: "device:event1", date: day, amount: 100, source: "device")
        state.add(event, now: day, calendar: calendar)
        state.add(event, now: day, rewardEligible: false, calendar: calendar)
        state.add(WaterRecord(date: day, amount: 100, source: "device"), now: day, rewardEligible: false, calendar: calendar)
        XCTAssertEqual(state.total(on: day, calendar: calendar), 300)
        XCTAssertEqual(state.tickets, 1)
        XCTAssertEqual(state.fishingRemainderMl, 0)
    }
    func testVersionOneMigrationPreservesFishAndTicketsWithoutRecreditingHistory() throws {
        var legacy = PondData()
        legacy.add(WaterRecord(id: "old", date: day, amount: 700), now: day, calendar: calendar)
        _ = legacy.catchFish(roll: 99, now: day)
        legacy.version = 1
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(legacy)) as? [String: Any])
        object.removeValue(forKey: "fishingRemainderMl")
        let original = try JSONSerialization.data(withJSONObject: object)
        let url = temporaryFile()
        try original.write(to: url)
        var upgraded = try PondPersistence.load(from: url)
        XCTAssertEqual(upgraded.version, 2)
        XCTAssertEqual(upgraded.fish, legacy.fish)
        XCTAssertEqual(upgraded.tickets, 2)
        XCTAssertEqual(upgraded.total(on: day, calendar: calendar), 700)
        XCTAssertEqual(upgraded.fishingRemainderMl, 0)
        XCTAssertFalse(upgraded.add(WaterRecord(id: "old", date: day, amount: 700), now: day, calendar: calendar))
        upgraded.add(WaterRecord(date: day, amount: 200), now: day, calendar: calendar)
        XCTAssertEqual(upgraded.tickets, 3)
        try PondPersistence.save(upgraded, to: url)
        let backup = url.deletingLastPathComponent().appendingPathComponent("state-v1-backup.json")
        XCTAssertEqual(try Data(contentsOf: backup), original)
        XCTAssertEqual(try PondPersistence.load(from: url), upgraded)
    }
    func testMalformedRemainderDoesNotSilentlyEraseProgress() throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(PondData())) as? [String: Any])
        let url = temporaryFile()
        for amount in [-1, 200, 999] {
            object["fishingRemainderMl"] = amount
            try JSONSerialization.data(withJSONObject: object).write(to: url)
            XCTAssertThrowsError(try PondPersistence.load(from: url))
        }
    }
    private func temporaryFile() -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("state.json")
    }
}
