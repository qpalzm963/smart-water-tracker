import XCTest
@testable import PondCore

final class FishingMotionTests: XCTestCase {
    func testStoryboardBeatsAndHiddenFishBeforeExit() {
        XCTAssertEqual(FishingMotion(elapsed: 0.399).phase, .bite)
        XCTAssertEqual(FishingMotion(elapsed: 0.4).phase, .pull)
        XCTAssertEqual(FishingMotion(elapsed: 1).phase, .flight)
        XCTAssertEqual(FishingMotion(elapsed: 1.8).phase, .celebrate)
        for t in stride(from: 0.0, through: 1, by: 0.05) {
            XCTAssertEqual(FishingMotion(elapsed: t).fishOpacity, 0)
        }
        XCTAssertEqual(FishingMotion(elapsed: 1.2).fishOpacity, 1)
        XCTAssertEqual(FishingMotion(elapsed: 1.2).bobberOpacity, 0)
    }

    func testMotionRemainsContinuousAndWithinSceneAcrossEveryBeat() {
        var previous = FishingMotion(elapsed: 0)
        for t in stride(from: 0.001, through: FishingMotion.duration, by: 0.001) {
            let current = FishingMotion(elapsed: t)
            for (a, b) in [(previous.grip, current.grip), (previous.tip, current.tip),
                           (previous.bend, current.bend), (previous.fishCenter, current.fishCenter)] {
                XCTAssertLessThan(hypot(a.x-b.x, a.y-b.y), 0.004, "Discontinuity at \(t)")
                XCTAssertTrue((0...1).contains(b.x) && (0...1).contains(b.y))
            }
            previous = current
        }
        let launch = FishingMotion(elapsed: 1).fishCenter
        XCTAssertEqual(launch.x, 0.70, accuracy: 0.0001)
        XCTAssertEqual(launch.y, 0.73, accuracy: 0.0001)
        XCTAssertLessThan(FishingMotion(elapsed: 1.5).fishCenter.y, FishingMotion(elapsed: 1.8).fishCenter.y)
    }

    func testLateFramesClampToFinishedPoseForReopenedOrHiddenWindows() {
        let finished = FishingMotion(elapsed: FishingMotion.duration)
        let reopened = FishingMotion(elapsed: 60)
        XCTAssertEqual(reopened.grip, finished.grip)
        XCTAssertEqual(reopened.fishCenter, finished.fishCenter)
        XCTAssertEqual(reopened.happyBlend, 1)
        XCTAssertEqual(FishingMotion(elapsed: -1).elapsed, 0)
        XCTAssertEqual(FishingMotion(elapsed: .nan).elapsed, 0)
    }
}
