import Foundation

public enum TaiwanCity: String, Codable, CaseIterable, Identifiable {
    case taipei, newTaipei, keelung, taoyuan, hsinchuCity, hsinchuCounty, miaoli
    case taichung, changhua, nantou, yunlin, chiayiCity, chiayiCounty, tainan
    case kaohsiung, pingtung, yilan, hualien, taitung, penghu, kinmen, lienchiang

    public var id: String { rawValue }
    // Representative city/county seats; these are not the user's precise location.
    private var location: (String, Double, Double) {
        switch self {
        case .taipei: return ("台北市", 25.033, 121.565)
        case .newTaipei: return ("新北市", 25.012, 121.465)
        case .keelung: return ("基隆市", 25.128, 121.739)
        case .taoyuan: return ("桃園市", 24.994, 121.301)
        case .hsinchuCity: return ("新竹市", 24.804, 120.971)
        case .hsinchuCounty: return ("新竹縣", 24.839, 121.018)
        case .miaoli: return ("苗栗縣", 24.560, 120.821)
        case .taichung: return ("台中市", 24.162, 120.647)
        case .changhua: return ("彰化縣", 24.076, 120.545)
        case .nantou: return ("南投縣", 23.915, 120.684)
        case .yunlin: return ("雲林縣", 23.709, 120.543)
        case .chiayiCity: return ("嘉義市", 23.480, 120.449)
        case .chiayiCounty: return ("嘉義縣", 23.459, 120.293)
        case .tainan: return ("台南市", 22.999, 120.227)
        case .kaohsiung: return ("高雄市", 22.627, 120.301)
        case .pingtung: return ("屏東縣", 22.671, 120.488)
        case .yilan: return ("宜蘭縣", 24.753, 121.754)
        case .hualien: return ("花蓮縣", 23.991, 121.601)
        case .taitung: return ("台東縣", 22.755, 121.150)
        case .penghu: return ("澎湖縣", 23.566, 119.579)
        case .kinmen: return ("金門縣", 24.433, 118.320)
        case .lienchiang: return ("連江縣", 26.151, 119.929)
        }
    }
    public var name: String { location.0 }
    public var latitude: Double { location.1 }
    public var longitude: Double { location.2 }
}

public enum WeatherCondition: String, Codable, CaseIterable {
    case clear, cloudy, rain, thunderstorm, fog, snow, other
    public init(code: Int) {
        switch code {
        case 0, 1: self = .clear
        case 2, 3: self = .cloudy
        case 45, 48: self = .fog
        case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82: self = .rain
        case 95, 96, 99: self = .thunderstorm
        case 71, 73, 75, 77, 85, 86: self = .snow
        default: self = .other
        }
    }
    public var name: String {
        switch self {
        case .clear: return "晴天"
        case .cloudy: return "多雲"
        case .rain: return "雨天"
        case .thunderstorm: return "雷雨"
        case .fog: return "起霧"
        case .snow: return "降雪"
        case .other: return "其他天氣"
        }
    }
    public var symbol: String {
        switch self {
        case .clear: return "sun.max"
        case .cloudy: return "cloud"
        case .rain: return "cloud.rain"
        case .thunderstorm: return "cloud.bolt.rain"
        case .fog: return "cloud.fog"
        case .snow: return "cloud.snow"
        case .other: return "cloud"
        }
    }
    public var isRaining: Bool { self == .rain || self == .thunderstorm }
    public var exclusiveFish: FishSpecies? {
        switch self {
        case .rain: return .raindrop
        case .thunderstorm: return .thunderlight
        case .fog: return .mistveil
        default: return nil
        }
    }
}

public struct WeatherSnapshot: Codable, Equatable {
    public let city: TaiwanCity
    public let code: Int
    public let temperature: Double
    public let observedAt: Date
    public let fetchedAt: Date
    public var condition: WeatherCondition { WeatherCondition(code: code) }
    public init(city: TaiwanCity, code: Int, temperature: Double, observedAt: Date, fetchedAt: Date) {
        self.city = city; self.code = code; self.temperature = temperature
        self.observedAt = observedAt; self.fetchedAt = fetchedAt
    }
    public func isUsable(for city: TaiwanCity?, at now: Date) -> Bool {
        let age = now.timeIntervalSince(fetchedAt)
        let observationAge = now.timeIntervalSince(observedAt)
        return self.city == city && temperature.isFinite && (-100...70).contains(temperature) && age >= 0 && age <= 7200
            && observationAge >= -300 && observationAge <= 7200
    }
}
