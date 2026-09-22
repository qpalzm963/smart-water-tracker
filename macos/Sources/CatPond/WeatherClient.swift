import Foundation
import PondCore

protocol WeatherFetching {
    func fetch(city: TaiwanCity) async throws -> WeatherSnapshot
}

struct OpenMeteoClient: WeatherFetching {
    var session: URLSession = .shared

    static func request(for city: TaiwanCity) -> URLRequest {
        var url = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        url.queryItems = [
            URLQueryItem(name: "latitude", value: String(city.latitude)),
            URLQueryItem(name: "longitude", value: String(city.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,weather_code"),
            URLQueryItem(name: "timeformat", value: "unixtime"),
            URLQueryItem(name: "timezone", value: "Asia/Taipei"),
            URLQueryItem(name: "forecast_days", value: "1")
        ]
        return URLRequest(url: url.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
    }

    func fetch(city: TaiwanCity) async throws -> WeatherSnapshot {
        let (data, response) = try await session.data(for: Self.request(for: city))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try Self.decode(data, city: city, now: Date())
    }

    static func decode(_ data: Data, city: TaiwanCity, now: Date) throws -> WeatherSnapshot {
        struct Response: Decodable {
            struct Current: Decodable {
                let time: Double
                let temperature_2m: Double
                let weather_code: Int
            }
            let current: Current
        }
        let current = try JSONDecoder().decode(Response.self, from: data).current
        let result = WeatherSnapshot(city: city, code: current.weather_code, temperature: current.temperature_2m,
                                     observedAt: Date(timeIntervalSince1970: current.time), fetchedAt: now)
        guard result.isUsable(for: city, at: now) else { throw URLError(.cannotParseResponse) }
        return result
    }
}
