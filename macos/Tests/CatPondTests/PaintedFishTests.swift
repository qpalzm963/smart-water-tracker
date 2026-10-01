import XCTest
import SwiftUI
import AppKit
@testable import CatPond
@testable import PondCore

final class PaintedFishTests: XCTestCase {
    @MainActor
    func testEveryPaintedSpeciesRendersInsideItsCanvas() throws {
        let painted = FishSpecies.allCases.filter { $0.spriteBounds == nil }
        XCTAssertEqual(painted.count, 10)
        for species in painted {
            let renderer = ImageRenderer(content: PaintedFish(species: species).frame(width: 250, height: 200))
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.cgImage)
            let bitmap = NSBitmapImageRep(cgImage: image)
            var inked = 0, border = 0
            for y in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
                for x in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
                    guard (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.08 else { continue }
                    inked += 1
                    if x < 6 || y < 6 || x >= bitmap.pixelsWide - 6 || y >= bitmap.pixelsHigh - 6 { border += 1 }
                }
            }
            // Visible at small game size, with complete fins that never touch the canvas edge.
            XCTAssertGreaterThan(inked, 12_000 / 4, "\(species) is too faint")
            XCTAssertEqual(border, 0, "\(species) is clipped by the canvas")
        }
    }

    @MainActor
    func testRenderFishGallery() throws {
        guard let path = ProcessInfo.processInfo.environment["CATPOND_QA_ARTIFACTS"] else { return }
        let output = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let columns = Array(repeating: GridItem(.fixed(240), spacing: 12), count: 6)
        let gallery = LazyVGrid(columns: columns, spacing: 12) {
            ForEach(FishSpecies.allCases) { species in
                VStack(spacing: 4) {
                    FishDrawing(species: species).frame(width: 240, height: 180)
                    Text("\(species.name) · \(species.rarity)").font(.system(size: 13))
                }
            }
        }.padding(20).frame(width: 1560).background(PondStyle.cream)
        let renderer = ImageRenderer(content: gallery)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.cgImage)
        try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
            .write(to: output.appendingPathComponent("fish-gallery.png"))
    }
}
