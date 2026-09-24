import SwiftUI
import Charts
import PondCore

struct RecordsView: View {
    @ObservedObject var store: PondStore
    @Binding var visibleCount: Int
    @Binding var custom: String
    @State private var pendingDelete: WaterRecord?
    private var days: [Date] { (0..<7).reversed().compactMap { Calendar.current.date(byAdding: .day, value: -$0, to: store.now) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            PageHeader(title: "喝水紀錄", subtitle: "照自己的步調，好好喝水。", eyebrow: "照顧自己的日常")
            PondCard {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 28) { todaySummary; Spacer(minLength: 8); logForm }
                    VStack(alignment: .leading, spacing: 24) { todaySummary; Divider(); logForm }
                }
                if let toast = store.toast {
                    Label(toast, systemImage: "checkmark.circle.fill").font(.system(size: 12)).foregroundStyle(PondStyle.teal).padding(.top, 10)
                }
            }
            HStack(spacing: 9) {
                Image(systemName: "fish").font(.system(size: 15))
                Text(store.fishingProgressText).font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            }.foregroundStyle(PondStyle.teal)
            PondCard {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top) {
                        SectionTitle(title: "最近七天", subtitle: "每日喝水量 · ml")
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("\(days.reduce(0) { $0 + store.data.total(on: $1) }.formatted()) ml")
                                .font(.system(size: 18, weight: .medium, design: .rounded)).monospacedDigit()
                            Text("七天合計").font(.system(size: 11)).foregroundStyle(PondStyle.muted)
                        }
                    }
                    Chart {
                        ForEach(days, id: \.self) { day in
                            BarMark(x: .value("日期", day, unit: .day), y: .value("喝水量", store.data.total(on: day)))
                                .foregroundStyle(Calendar.current.isDate(day, inSameDayAs: store.now) ? PondStyle.teal : PondStyle.teal.opacity(0.40))
                                .cornerRadius(5)
                                .accessibilityLabel(day.formatted(date: .abbreviated, time: .omitted))
                                .accessibilityValue("\(store.data.total(on: day)) 毫升")
                        }
                        RuleMark(y: .value("目標", store.data.goal)).foregroundStyle(PondStyle.coral.opacity(0.7))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    }
                    .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.abbreviated)) } }
                    .chartYScale(domain: 0...max(store.data.goal, days.map { store.data.total(on: $0) }.max() ?? 0) * 11 / 10)
                    .frame(height: 165)
                    Label("虛線為目前每日目標 \(store.data.goal) ml", systemImage: "minus")
                        .font(.system(size: 11)).foregroundStyle(PondStyle.muted)
                }
            }
            HStack {
                SectionTitle(title: "每一杯的紀錄", subtitle: "\(store.data.records.count) 筆紀錄")
                Spacer()
                Button { store.exportRecords() } label: { Label("匯出紀錄", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.bordered)
            }
            if store.data.records.isEmpty {
                PondEmptyState(title: "從今天的第一杯開始", message: "在上方記錄喝水，或到設定連接智慧杯墊。", symbol: "drop")
            } else {
                LazyVStack(spacing: 22) {
                    ForEach(DetailData.recordDays(store.data.records, limit: visibleCount)) { day in
                        VStack(spacing: 0) {
                            HStack {
                                Text(dayLabel(day.date)).font(.system(size: 13, weight: .semibold))
                                Spacer()
                                Text("\(store.data.total(on: day.date).formatted()) ml").font(.system(size: 12, weight: .medium)).monospacedDigit()
                            }.foregroundStyle(PondStyle.teal).padding(.bottom, 8)
                            ForEach(day.records) { record in
                                recordRow(record)
                                Divider().overlay(PondStyle.line.opacity(0.25))
                            }
                        }
                    }
                    if visibleCount < store.data.records.count {
                        Button("載入更多紀錄（還有 \(store.data.records.count - visibleCount) 筆）") { visibleCount += 50 }
                            .buttonStyle(.bordered).controlSize(.large)
                    }
                }
            }
        }.confirmationDialog("刪除這筆手動紀錄？", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("刪除紀錄", role: .destructive) { if let record = pendingDelete { store.remove(record) }; pendingDelete = nil }
            Button("取消", role: .cancel) { pendingDelete = nil }
        } message: { Text("喝水總量會更新，已計入的釣魚次數與累積進度不會回溯或重複發放。") }
    }

    private var todaySummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("今天").font(.system(size: 12, weight: .medium)).foregroundStyle(PondStyle.muted)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(store.total.formatted()).font(.system(size: 40, weight: .medium, design: .rounded)).monospacedDigit()
                Text("ml").font(.system(size: 14)).foregroundStyle(PondStyle.muted)
            }
            ProgressView(value: store.progress).frame(width: 190)
            Text(store.total >= store.data.goal ? "今天的目標已達成" : "距離目標還有 \(store.data.goal - store.total) ml")
                .font(.system(size: 12)).foregroundStyle(PondStyle.muted)
        }.fixedSize(horizontal: true, vertical: false)
    }
    private var logForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("記錄一杯水").font(.system(size: 14, weight: .semibold))
            QuickLogForm(store: store, custom: $custom)
        }.fixedSize(horizontal: true, vertical: false)
    }
    private func dayLabel(_ date: Date) -> String {
        if Calendar.current.isDate(date, inSameDayAs: store.now) { return "今天 · " + date.formatted(.dateTime.month().day()) }
        if let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: store.now), Calendar.current.isDate(date, inSameDayAs: yesterday) {
            return "昨天 · " + date.formatted(.dateTime.month().day())
        }
        return date.formatted(.dateTime.year().month().day().weekday())
    }
    private func recordRow(_ record: WaterRecord) -> some View {
        HStack(spacing: 14) {
            Image(systemName: record.kind == "drink" ? "drop.fill" : "arrow.clockwise")
                .font(.system(size: 16)).foregroundStyle(record.kind == "drink" ? PondStyle.teal : PondStyle.muted)
                .frame(width: 37, height: 37).background(PondStyle.teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 5) {
                Text(record.kind == "drink" ? "喝水" : "補水").font(.system(size: 13, weight: .medium))
                Text(record.date, format: .dateTime.hour().minute()).font(.system(size: 11)).foregroundStyle(PondStyle.muted)
            }
            Spacer()
            Text(record.isManual ? "手動" : record.estimatedTime ? "杯墊 · 接收時間" : "杯墊")
                .font(.system(size: 11)).foregroundStyle(PondStyle.muted)
            Text("\(record.amount) ml").font(.system(size: 15, weight: .medium, design: .rounded)).monospacedDigit().frame(minWidth: 72, alignment: .trailing)
            if record.isManual {
                Button { pendingDelete = record } label: { Image(systemName: "trash").frame(width: 28, height: 30) }
                    .buttonStyle(.borderless).foregroundStyle(PondStyle.muted)
                    .help("刪除這筆手動紀錄").accessibilityLabel("刪除 \(record.amount) 毫升手動紀錄")
            } else { Color.clear.frame(width: 28, height: 30).accessibilityHidden(true) }
        }.padding(.vertical, 12)
    }
}
