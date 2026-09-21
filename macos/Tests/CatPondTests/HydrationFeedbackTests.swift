import XCTest
import PondCore
@testable import CatPond

final class HydrationFeedbackTests: XCTestCase {
    @MainActor
    private func store() -> PondStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return PondStore(file: directory.appendingPathComponent("state.json"))
    }

    private func event(_ id: String, kind: String = "drink") throws -> DeviceEvent {
        let json = "{\"eventId\":\"\(id)\",\"occurredAt\":0,\"type\":\"\(kind)\",\"amountMl\":80,\"timeSynced\":false}"
        return try JSONDecoder().decode(DeviceEvent.self, from: Data(json.utf8))
    }

    @MainActor
    func testBurstCombinesAndExpires() async throws {
        let store = store()
        XCTAssertTrue(store.log(amount: 50))
        let trigger = store.hydrationTrigger
        XCTAssertTrue(store.log(amount: 100))
        XCTAssertEqual(store.hydrationAmount, 150)
        XCTAssertNotEqual(store.hydrationTrigger, trigger)
        try await Task.sleep(for: .seconds(1.7))
        XCTAssertEqual(store.hydrationAmount, 0)
        XCTAssertTrue(store.log(amount: 30))
        XCTAssertEqual(store.hydrationAmount, 30)
    }

    @MainActor
    func testOnlyNewLiveDrinkTriggers() async throws {
        let store = store()
        let trigger = store.hydrationTrigger
        store.receive(try event("history"), peripheralID: "cup", replay: true)
        store.receive(try event("refill", kind: "refill"), peripheralID: "cup", replay: false)
        XCTAssertEqual(store.hydrationTrigger, trigger)
        store.receive(try event("live"), peripheralID: "cup", replay: false)
        XCTAssertEqual(store.hydrationAmount, 80)
        let liveTrigger = store.hydrationTrigger
        store.receive(try event("live"), peripheralID: "cup", replay: false)
        XCTAssertEqual(store.hydrationTrigger, liveTrigger)
        XCTAssertEqual(store.hydrationAmount, 80)
    }

    @MainActor
    func testHiddenAndReelingDoNotReplay() async {
        let store = store()
        store.log(amount: 200)
        store.pondVisible = false
        XCTAssertEqual(store.hydrationAmount, 0)
        store.log(amount: 50)
        store.pondVisible = true
        XCTAssertEqual(store.hydrationAmount, 0)
        store.log(amount: 50)
        store.reel()
        XCTAssertEqual(store.hydrationAmount, 0)
        store.log(amount: 50)
        XCTAssertEqual(store.hydrationAmount, 0)
    }

    @MainActor
    func testFailedSaveAndDeletionDoNotTrigger() async throws {
        let store = store()
        store.log(amount: 100)
        store.pondVisible = false
        store.pondVisible = true
        let trigger = store.hydrationTrigger
        store.remove(try XCTUnwrap(store.data.records.first))
        XCTAssertEqual(store.hydrationTrigger, trigger)
        XCTAssertFalse(store.log(amount: 0))
        XCTAssertEqual(store.hydrationAmount, 0)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let blocked = PondStore(file: directory.appendingPathComponent("blocked/state.json"))
        try Data().write(to: directory.appendingPathComponent("blocked"))
        XCTAssertFalse(blocked.log(amount: 100))
        XCTAssertEqual(blocked.hydrationAmount, 0)
    }
}
