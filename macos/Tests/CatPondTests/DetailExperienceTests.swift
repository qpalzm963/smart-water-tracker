import XCTest
import SwiftUI
import AppKit
import PondCore
@testable import CatPond

final class DetailExperienceTests: XCTestCase {
    func testInputBoundsRejectInvalidAndAcceptTrimmedValues() {
        for text in ["", "0", "-1", "5001", "2.5", "abc", "999999999999999999999"] {
            XCTAssertNil(PondInput.amount(text, range: 1...5000), text)
        }
        XCTAssertEqual(PondInput.amount(" 200 \n", range: 1...5000), 200)
        XCTAssertEqual(PondInput.amount("1", range: 1...5000), 1)
        XCTAssertEqual(PondInput.amount("5000", range: 1...5000), 5000)
        XCTAssertNil(PondInput.amount("99", range: 100...10000))
        XCTAssertEqual(PondInput.amount("10000", range: 100...10000), 10000)
    }

    func testDayGroupingAcrossMidnightAndPaginationKeepsEveryRecordOnce() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        let midnight = calendar.date(from: DateComponents(year: 2026, month: 9, day: 22))!
        let records = [WaterRecord(date: midnight.addingTimeInterval(-1), amount: 150),
                       WaterRecord(date: midnight, amount: 200),
                       WaterRecord(date: midnight.addingTimeInterval(1), amount: 350, kind: "refill")]
        let days = DetailData.recordDays(records, limit: 50, calendar: calendar)
        XCTAssertEqual(days.count, 2)
        XCTAssertEqual(days[0].records.count, 2)
        XCTAssertEqual(days[0].total, 200)
        XCTAssertEqual(days.flatMap(\.records).map(\.id), records.reversed().map(\.id))
        XCTAssertEqual(DetailData.recordDays(records, limit: 1, calendar: calendar).flatMap(\.records).count, 1)
        XCTAssertTrue(DetailData.recordDays([], limit: 50).isEmpty)
    }

    func testLatestTwelvePreserveIdentitiesAndFishTraverseTheTank() {
        let fish = (0..<20).map { CaughtFish(species: FishSpecies.allCases[$0 % 8]) }
        XCTAssertEqual(DetailData.displayedFish(fish).map(\.id), Array(fish.suffix(12)).map(\.id))
        for species in FishSpecies.allCases {
            for index in 0..<12 {
                let points = stride(from: 0.0, through: 60.0, by: 0.05).map {
                    AquariumPlacement.sample(index: index, time: $0, speed: species.swimSpeed)
                }
                XCTAssertGreaterThan(points.map(\.x).max()! - points.map(\.x).min()!, 0.75)
                XCTAssertGreaterThan(points.map(\.y).max()! - points.map(\.y).min()!, 0.25)
                for (i, point) in points.enumerated() {
                    XCTAssertTrue((0.119...0.881).contains(point.x))
                    XCTAssertTrue((0.224...0.696).contains(point.y))
                    if i > 0 {
                        let previous = points[i - 1]
                        XCTAssertLessThan(abs(point.x - previous.x), 0.005)
                        XCTAssertLessThan(abs(point.y - previous.y), 0.002)
                        XCTAssertLessThan(abs(point.facing - previous.facing), 0.10)
                        if abs(point.facing) > 0.1 {
                            XCTAssertGreaterThan((point.x - previous.x) * point.facing, 0)
                        }
                    }
                    if i >= 100 {
                        // Even around a turn, five seconds must show visible travel.
                        let recent = points[(i - 100)...i].map(\.x)
                        XCTAssertGreaterThan(recent.max()! - recent.min()!, 0.025)
                    }
                }
            }
        }
    }

    @MainActor
    func testGoalSaveReportsFailuresWithoutClaimingSuccess() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("state.json")
        let store = PondStore(file: file)
        XCTAssertTrue(store.updateGoal(2300))
        XCTAssertEqual(try PondPersistence.load(from: file).goal, 2300)
        XCTAssertFalse(store.updateGoal(99))
        XCTAssertEqual(store.data.goal, 2300)
        let brokenFile = dir.appendingPathComponent("broken.json")
        try Data("invalid".utf8).write(to: brokenFile)
        let broken = PondStore(file: brokenFile)
        XCTAssertFalse(broken.updateGoal(2400))
        XCTAssertEqual(try String(contentsOf: brokenFile), "invalid")
    }

    @MainActor
    func testRenderDetailStatesWithoutChangingFixture() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("state.json")
        let now = Date()
        var data = PondData()
        for i in 0..<60 {
            let day = Calendar.current.date(byAdding: .day, value: -(i / 9), to: now)!
            data.add(WaterRecord(date: day.addingTimeInterval(-Double(i % 9) * 1800), amount: 100 + i % 4 * 50,
                                 source: i % 2 == 0 ? "manual" : "qa-device", kind: i % 13 == 0 ? "refill" : "drink"), now: now)
        }
        data.fish = (0..<16).map { CaughtFish(species: FishSpecies.allCases[$0 % 8], date: now.addingTimeInterval(-Double(16 - $0) * 3600), city: $0 % 2 == 0 ? .taipei : nil, weather: $0 % 2 == 0 ? .rain : nil) }
        data.weatherCity = .taipei
        data.weatherCache = WeatherSnapshot(city: .taipei, code: 61, temperature: 24, observedAt: now, fetchedAt: now)
        try PondPersistence.save(data, to: file)
        let original = try Data(contentsOf: file)
        let store = PondStore(file: file)
        let bluetooth = BluetoothManager(store: store)
        let output = ProcessInfo.processInfo.environment["CATPOND_QA_ARTIFACTS"].map { URL(fileURLWithPath: $0) }
        if let output {
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            try original.write(to: output.appendingPathComponent("state.json"))
        }
        for section in ["aquarium", "collection", "records", "settings"] {
            for width in [820.0, 1100.0] {
                let content = DetailView(store: store, bluetooth: bluetooth, selection: .constant(section))
                try await render(content, name: "\(section)-\(Int(width))", size: CGSize(width: width, height: 760), output: output)
            }
        }
        for decoration in ["水草", "石頭", "小屋"] {
            try await render(AquariumView(fish: DetailData.displayedFish(data.fish), decoration: decoration, paused: true), name: "tank-" + decoration, size: CGSize(width: 760, height: 410), output: output)
        }
        try await render(AquariumPage(store: store, selection: .constant("aquarium")).padding(28).background(PondStyle.paper).foregroundStyle(PondStyle.ink).tint(PondStyle.teal).environment(\.colorScheme, .light), name: "aquarium-page", size: CGSize(width: 920, height: 1060), output: output)
        try await render(FishDetailSheet(species: .peach, catches: data.fish.filter { $0.species == .peach }, selected: data.fish.first), name: "fish-detail", size: CGSize(width: 490, height: 620), output: output)
        try await render(FishDetailSheet(species: .mistveil, catches: []), name: "undiscovered-detail", size: CGSize(width: 490, height: 620), output: output)
        try await render(SettingsView(store: store, bluetooth: bluetooth, goal: .constant("99")).padding(28).background(PondStyle.paper).environment(\.colorScheme, .light), name: "settings-invalid", size: CGSize(width: 780, height: 1250), output: output)
        let empty = PondStore(file: dir.appendingPathComponent("empty.json"))
        try await render(DetailView(store: empty, bluetooth: bluetooth, selection: .constant("aquarium")), name: "aquarium-empty", size: CGSize(width: 1000, height: 900), output: output)
        try await render(DetailView(store: empty, bluetooth: bluetooth, selection: .constant("collection")), name: "collection-empty", size: CGSize(width: 1000, height: 900), output: output)
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    @MainActor
    private func render<V: View>(_ content: V, name: String, size: CGSize, output: URL?) async throws {
        let hosting = NSHostingView(rootView: content.frame(width: size.width, height: size.height))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(70))
        let bitmap = try XCTUnwrap(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        XCTAssertGreaterThan(bitmap.pixelsWide, 0)
        window.contentView = nil
        if let output {
            try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: output.appendingPathComponent(name + ".png"))
        }
    }
}
