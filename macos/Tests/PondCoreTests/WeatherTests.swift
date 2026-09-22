import XCTest
@testable import PondCore

final class WeatherTests: XCTestCase {
    let date = Date(timeIntervalSince1970: 1_790_000_000)
    func snapshot(code: Int = 61, city: TaiwanCity = .taipei) -> WeatherSnapshot {
        WeatherSnapshot(city: city, code: code, temperature: 24, observedAt: date, fetchedAt: date)
    }

    func testWeatherCodesKeepExclusivePoolsSeparate() {
        for code in [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82] {
            XCTAssertEqual(WeatherCondition(code: code).exclusiveFish, .raindrop)
        }
        for code in [95, 96, 99] { XCTAssertEqual(WeatherCondition(code: code).exclusiveFish, .thunderlight) }
        for code in [45, 48] { XCTAssertEqual(WeatherCondition(code: code).exclusiveFish, .mistveil) }
        for code in [0, 1, 2, 3, 71, 73, 75, 77, 85, 86, -1, 100] {
            XCTAssertNil(WeatherCondition(code: code).exclusiveFish)
        }
    }

    func testExactTwentyPercentAndUnchangedRelativeOrdinaryOdds() {
        for weather in WeatherCondition.allCases {
            var counts: [FishSpecies: Int] = [:]
            for ordinaryRoll in 0..<100 {
                for specialRoll in 0..<100 {
                    let fish = FishSpecies.draw(roll: ordinaryRoll, weather: weather, weatherRoll: specialRoll)
                    counts[fish, default: 0] += 1
                }
            }
            let multiplier = weather.exclusiveFish == nil ? 100 : 80
            for (fish, weight) in [(FishSpecies.peach, 32), (.sunshine, 28), (.mint, 22), (.blueberry, 14), (.moon, 4)] {
                XCTAssertEqual(counts[fish], weight * multiplier)
            }
            if let special = weather.exclusiveFish { XCTAssertEqual(counts[special], 2000) }
            XCTAssertEqual(counts.values.reduce(0, +), 10000)
        }
    }

    func testCacheExpiresAndCannotCrossCitiesOrUseFutureDates() {
        let weather = snapshot()
        XCTAssertTrue(weather.isUsable(for: .taipei, at: date.addingTimeInterval(7200)))
        XCTAssertFalse(weather.isUsable(for: .taipei, at: date.addingTimeInterval(7201)))
        XCTAssertFalse(weather.isUsable(for: .taipei, at: date.addingTimeInterval(-1)))
        XCTAssertFalse(weather.isUsable(for: .tainan, at: date))
        XCTAssertFalse(weather.isUsable(for: nil, at: date))
        let old = WeatherSnapshot(city: .taipei, code: 61, temperature: 24,
                                  observedAt: date.addingTimeInterval(-7201), fetchedAt: date)
        XCTAssertFalse(old.isUsable(for: .taipei, at: date))
    }

    func testCatchLocksWeatherAndPreservesTicketsAndCollectionAcrossRestart() throws {
        var state = PondData()
        state.weatherCity = .taipei
        state.add(WaterRecord(date: date, amount: 400), now: date)
        let fish = state.catchFish(roll: 99, now: date, weather: snapshot(code: 95), weatherRoll: 19)
        XCTAssertEqual(fish?.species, .thunderlight)
        XCTAssertEqual(fish?.city, .taipei)
        XCTAssertEqual(fish?.weather, .thunderstorm)
        state.weatherCity = .tainan
        let second = state.catchFish(roll: 99, now: date, weather: snapshot(), weatherRoll: 0)
        XCTAssertEqual(second?.species, .moon)
        XCTAssertNil(second?.weather)
        XCTAssertEqual(state.tickets, 0)
        XCTAssertNil(state.catchFish(now: date, weather: snapshot(), weatherRoll: 0))
        let restored = try JSONDecoder().decode(PondData.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored, state)
        XCTAssertEqual(restored.fish.first?.weather, .thunderstorm)
    }

    func testExpiredWeatherOnlyCatchesOrdinaryFish() {
        var state = PondData(); state.weatherCity = .taipei
        state.add(WaterRecord(date: date, amount: 200), now: date)
        let fish = state.catchFish(roll: 0, now: date.addingTimeInterval(7201), weather: snapshot(), weatherRoll: 0)
        XCTAssertEqual(fish?.species, .peach)
        XCTAssertNil(fish?.weather)
    }

    func testOldV2CollectionWithoutWeatherFieldsLoadsLosslessly() throws {
        var old = PondData()
        old.add(WaterRecord(date: date, amount: 450), now: date)
        old.catchFish(roll: 99, now: date)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as? [String: Any])
        json.removeValue(forKey: "weatherCity"); json.removeValue(forKey: "weatherCache")
        var fish = try XCTUnwrap(json["fish"] as? [[String: Any]])
        for i in fish.indices { fish[i].removeValue(forKey: "city"); fish[i].removeValue(forKey: "weather") }
        json["fish"] = fish
        let restored = try JSONDecoder().decode(PondData.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(restored, old)
        XCTAssertEqual(restored.fishingRemainderMl, 50)
        XCTAssertEqual(restored.tickets, 1)
        // A disposable cache cannot make all saved fish unreadable.
        json["weatherCache"] = ["broken": true]
        XCTAssertEqual(try JSONDecoder().decode(PondData.self, from: JSONSerialization.data(withJSONObject: json)), old)
    }
}
