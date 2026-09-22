import XCTest
import SwiftUI
import PondCore
@testable import CatPond

private actor ControlledWeatherClient: WeatherFetching {
    private var pending: [CheckedContinuation<WeatherSnapshot, Error>] = []
    private(set) var cities: [TaiwanCity] = []
    func fetch(city: TaiwanCity) async throws -> WeatherSnapshot {
        cities.append(city)
        return try await withCheckedThrowingContinuation { pending.append($0) }
    }
    func succeed(_ index: Int, code: Int) {
        let now = Date()
        pending[index].resume(returning: WeatherSnapshot(city: cities[index], code: code, temperature: 24,
                                                       observedAt: now, fetchedAt: now))
    }
    func fail(_ index: Int) { pending[index].resume(throwing: URLError(.notConnectedToInternet)) }
}

final class WeatherIntegrationTests: XCTestCase {
    private func file() -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("state.json")
    }
    @MainActor
    private func waitFor(_ predicate: () async -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<200 {
            if await predicate() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("Timed out waiting for weather state", file: file, line: line)
    }

    @MainActor
    func testCitySwitchDiscardsLateResponseAndPersistsNewSelection() async throws {
        let client = ControlledWeatherClient(), url = file()
        let store = PondStore(file: url, weatherClient: client)
        store.selectWeatherCity(.taipei)
        try await waitFor { await client.cities.count == 1 }
        store.selectWeatherCity(.tainan)
        XCTAssertNil(store.currentWeather)
        try await waitFor { await client.cities.count == 2 }
        await client.succeed(1, code: 95)
        try await waitFor { !store.weatherLoading }
        await client.succeed(0, code: 61)
        await Task.yield()
        XCTAssertEqual(store.currentWeather?.condition, .thunderstorm)
        XCTAssertEqual(store.currentWeather?.city, .tainan)
        let restored = PondStore(file: url, weatherClient: client)
        XCTAssertEqual(restored.data.weatherCity, .tainan)
        XCTAssertEqual(restored.currentWeather, store.currentWeather)
    }

    @MainActor
    func testOfflineCacheExpiresWithoutBlockingFishing() async throws {
        let client = ControlledWeatherClient(), url = file(), now = Date()
        var data = PondData(); data.weatherCity = .taipei
        data.weatherCache = WeatherSnapshot(city: .taipei, code: 61, temperature: 24, observedAt: now, fetchedAt: now)
        data.add(WaterRecord(date: now, amount: 200), now: now)
        try PondPersistence.save(data, to: url)
        let store = PondStore(file: url, weatherClient: client)
        store.refreshWeather()
        try await waitFor { await client.cities.count == 1 }
        await client.fail(0)
        try await waitFor { !store.weatherLoading }
        XCTAssertTrue(store.weatherFailed)
        XCTAssertEqual(store.currentWeather?.condition, .rain)
        store.now = now.addingTimeInterval(7201)
        XCTAssertNil(store.currentWeather)
        XCTAssertTrue(store.weatherSummary.contains("天氣暫時無法更新"))
        XCTAssertTrue(store.weatherDetail.contains("過期"))
        // Persist an actually expired snapshot so reel's fresh clock also rejects it.
        data.weatherCache = WeatherSnapshot(city: .taipei, code: 61, temperature: 24,
                                           observedAt: now.addingTimeInterval(-7300), fetchedAt: now.addingTimeInterval(-7300))
        try PondPersistence.save(data, to: url)
        let expired = PondStore(file: url, weatherClient: client)
        expired.reel(reduceMotion: true)
        XCTAssertNotNil(expired.caught)
        XCTAssertNil(expired.caught?.species.requiredWeather)
        XCTAssertNil(expired.caught?.weather)
        XCTAssertEqual(expired.data.tickets, 0)
    }

    @MainActor
    func testRefreshScheduleNoOverlappingRequestsAndRetry() async throws {
        let client = ControlledWeatherClient(), store = PondStore(file: file(), weatherClient: ControlledWeatherClient())
        store.startWeatherUpdates()
        XCTAssertFalse(store.weatherLoading)
        let selected = PondStore(file: file(), weatherClient: client)
        selected.selectWeatherCity(.taipei)
        selected.startWeatherUpdates()
        selected.refreshWeather()
        try await waitFor { await client.cities.count == 1 }
        await client.succeed(0, code: 45)
        try await waitFor { !selected.weatherLoading }
        let fetched = try XCTUnwrap(selected.currentWeather?.fetchedAt)
        selected.refreshWeatherIfNeeded(at: fetched.addingTimeInterval(1700))
        XCTAssertFalse(selected.weatherLoading)
        selected.refreshWeatherIfNeeded(at: fetched.addingTimeInterval(1801))
        try await waitFor { await client.cities.count == 2 }
        await client.fail(1)
        try await waitFor { !selected.weatherLoading }
        selected.refreshWeatherIfNeeded(at: Date().addingTimeInterval(301))
        try await waitFor { await client.cities.count == 3 }
        await client.succeed(2, code: 0)
        try await waitFor { !selected.weatherLoading }
        XCTAssertFalse(selected.weatherFailed)
        XCTAssertEqual(selected.currentWeather?.condition, .clear)
        selected.selectWeatherCity(nil)
        XCTAssertNil(selected.currentWeather)
        XCTAssertNil(selected.data.weatherCache)
    }

    func testDecodeRejectsStaleFutureMissingAndInvalidData() throws {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        func bytes(time: Double, temperature: Double = 24) throws -> Data {
            try JSONSerialization.data(withJSONObject: ["current": ["time": time, "temperature_2m": temperature, "weather_code": 95]])
        }
        let valid = try OpenMeteoClient.decode(bytes(time: now.timeIntervalSince1970), city: .taipei, now: now)
        XCTAssertEqual(valid.condition, .thunderstorm)
        XCTAssertEqual(valid.observedAt, now)
        XCTAssertThrowsError(try OpenMeteoClient.decode(bytes(time: now.timeIntervalSince1970 - 7201), city: .taipei, now: now))
        XCTAssertThrowsError(try OpenMeteoClient.decode(bytes(time: now.timeIntervalSince1970 + 301), city: .taipei, now: now))
        XCTAssertThrowsError(try OpenMeteoClient.decode(bytes(time: now.timeIntervalSince1970, temperature: 1e100), city: .taipei, now: now))
        for json in ["{}", "{\"current\":null}", "{\"error\":true}", "not json"] {
            XCTAssertThrowsError(try OpenMeteoClient.decode(Data(json.utf8), city: .taipei, now: now))
        }
        let url = try XCTUnwrap(OpenMeteoClient.request(for: .taipei).url)
        let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertTrue(query.contains(URLQueryItem(name: "timeformat", value: "unixtime")))
        XCTAssertTrue(query.contains(URLQueryItem(name: "current", value: "temperature_2m,weather_code")))
    }

    @MainActor
    func testReelCapturesWeatherOnceAndSurvivesRestart() throws {
        let url = file(), now = Date()
        var data = PondData(); data.weatherCity = .taipei
        data.weatherCache = WeatherSnapshot(city: .taipei, code: 45, temperature: 22, observedAt: now, fetchedAt: now)
        data.add(WaterRecord(date: now, amount: 400), now: now)
        try PondPersistence.save(data, to: url)
        let store = PondStore(file: url)
        store.reel(reduceMotion: true)
        store.reel(reduceMotion: true)
        XCTAssertEqual(store.caught?.weather, .fog)
        XCTAssertEqual(store.caught?.city, .taipei)
        XCTAssertEqual(store.data.tickets, 1)
        XCTAssertEqual(try PondPersistence.load(from: url).fish, store.data.fish)
        store.selectWeatherCity(nil)
        XCTAssertEqual(store.caught?.weather, .fog)
    }

    @MainActor
    func testRenderWeatherScenesAndAllFishAssets() async throws {
        // Optional review artifacts use only isolated test data, never the user's state.
        let output = ProcessInfo.processInfo.environment["CATPOND_QA_ARTIFACTS"].map { URL(fileURLWithPath: $0) }
        if let output { try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true) }
        for (name, code) in [("rain", 61), ("storm", 95), ("fog", 45), ("clear", 0)] {
            let url = file(), now = Date()
            var data = PondData(); data.weatherCity = .taipei
            data.weatherCache = WeatherSnapshot(city: .taipei, code: code, temperature: 24, observedAt: now, fetchedAt: now)
            try PondPersistence.save(data, to: url)
            let store = PondStore(file: url)
            let renderer = ImageRenderer(content: FishingSceneLayer(store: store, reduceMotion: true).frame(width: 460, height: 345))
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.cgImage)
            XCTAssertEqual(image.width, 920)
            if let output {
                let bitmap = NSBitmapImageRep(cgImage: image)
                try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: output.appendingPathComponent(name + ".png"))
            }
            if name == "rain", let output {
                // AppKit-backed controls are omitted by ImageRenderer; capture a native host instead.
                let settings = NSHostingView(rootView: WeatherSettingsView(store: store)
                    .padding(24).frame(width: 640, height: 400).background(PondStyle.cream))
                settings.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
                settings.layoutSubtreeIfNeeded()
                let settingsImage = try XCTUnwrap(settings.bitmapImageRepForCachingDisplay(in: settings.bounds))
                settings.cacheDisplay(in: settings.bounds, to: settingsImage)
                try XCTUnwrap(settingsImage.representation(using: .png, properties: [:]))
                    .write(to: output.appendingPathComponent("settings.png"))
                store.log(amount: 200)
                store.reel()
                for (pose, delay) in [("pull", 0.6), ("lift", 0.85), ("happy", 0.65)] {
                    try await Task.sleep(for: .seconds(delay))
                    let frame = ImageRenderer(content: FishingSceneLayer(store: store, reduceMotion: false)
                        .frame(width: 460, height: 345))
                    frame.scale = 2
                    let poseImage = try XCTUnwrap(frame.cgImage)
                    try XCTUnwrap(NSBitmapImageRep(cgImage: poseImage).representation(using: .png, properties: [:]))
                        .write(to: output.appendingPathComponent("rain-" + pose + ".png"))
                }
            }
        }
        let renderer = ImageRenderer(content: HStack {
            ForEach(FishSpecies.allCases) { FishDrawing(species: $0).frame(width: 140, height: 120) }
        }.padding().background(PondStyle.cream))
        let image = try XCTUnwrap(renderer.cgImage)
        if let output {
            try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
                .write(to: output.appendingPathComponent("fish.png"))
        }
    }
}
