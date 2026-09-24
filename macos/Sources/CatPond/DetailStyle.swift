import SwiftUI
import PondCore

extension PondStyle {
    static let paper = Color(red: 0.985, green: 0.974, blue: 0.944)
    static let surface = Color(red: 1, green: 0.994, blue: 0.975)
    static let muted = Color(red: 0.40, green: 0.43, blue: 0.38)
    static let line = Color(red: 0.85, green: 0.86, blue: 0.80)
}

struct PondCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .background(PondStyle.surface, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(PondStyle.line.opacity(0.65)))
    }
}

struct PageHeader: View {
    let title: String
    let subtitle: String
    var eyebrow = "小貓釣魚"
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(eyebrow).font(.system(size: 11, weight: .semibold)).tracking(2).foregroundStyle(PondStyle.teal)
            Text(title).font(.system(size: 30, weight: .semibold, design: .serif)).accessibilityAddTraits(.isHeader)
            Text(subtitle).font(.system(size: 13)).foregroundStyle(PondStyle.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

func pageHeading(_ title: String, subtitle: String) -> some View {
    PageHeader(title: title, subtitle: subtitle)
}

struct InfoPill: View {
    let text: String
    var symbol: String? = nil
    var color: Color = PondStyle.teal
    var body: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol) }
            Text(text)
        }.font(.system(size: 11, weight: .medium)).foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(color.opacity(0.09), in: Capsule())
    }
}

struct SectionTitle: View {
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 16, weight: .semibold)).accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(.system(size: 12)).foregroundStyle(PondStyle.muted) }
        }
    }
}

struct PondEmptyState: View {
    let title: String
    let message: String
    let symbol: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 28, weight: .light)).foregroundStyle(PondStyle.teal)
                .frame(width: 64, height: 64).background(PondStyle.teal.opacity(0.08), in: Circle())
            Text(title).font(.system(size: 18, weight: .semibold, design: .serif))
            Text(message).font(.system(size: 13)).foregroundStyle(PondStyle.muted).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 24)
    }
}

// Shared by the fields and tests; store-side validation remains authoritative.
enum PondInput {
    static func amount(_ text: String, range: ClosedRange<Int>) -> Int? {
        guard let value = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)), range.contains(value) else { return nil }
        return value
    }
}

struct RecordDay: Identifiable {
    let date: Date
    let records: [WaterRecord]
    var id: Date { date }
    var total: Int { records.filter { $0.kind == "drink" }.reduce(0) { $0 + $1.amount } }
}

enum DetailData {
    static func recordDays(_ records: [WaterRecord], limit: Int, calendar: Calendar = .current) -> [RecordDay] {
        let sorted = records.sorted { $0.date > $1.date }.prefix(max(0, limit))
        return Dictionary(grouping: sorted, by: { calendar.startOfDay(for: $0.date) })
            .map { RecordDay(date: $0.key, records: $0.value) }.sorted { $0.date > $1.date }
    }
    static func displayedFish(_ fish: [CaughtFish]) -> [CaughtFish] { Array(fish.suffix(12)) }
}

struct PondHoverButtonStyle: ButtonStyle {
    var radius: CGFloat = 12
    func makeBody(configuration: Configuration) -> some View {
        HoverContent(configuration: configuration, radius: radius)
    }
    private struct HoverContent: View {
        let configuration: ButtonStyleConfiguration
        let radius: CGFloat
        @State private var hovered = false
        @Environment(\.isFocused) private var focused
        var body: some View {
            configuration.label
                .opacity(configuration.isPressed ? 0.74 : 1)
                .overlay(RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(PondStyle.teal.opacity(focused ? 1 : hovered ? 0.5 : 0), lineWidth: focused ? 3 : 1.5))
                .onHover { hovered = $0 }
        }
    }
}
