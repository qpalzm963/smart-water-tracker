// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CatPond",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "CatPond", targets: ["CatPond"])],
    targets: [
        .target(name: "PondCore"),
        .executableTarget(name: "CatPond", dependencies: ["PondCore"], resources: [.process("Resources")]),
        .testTarget(name: "PondCoreTests", dependencies: ["PondCore"]),
        .testTarget(name: "CatPondTests", dependencies: ["CatPond", "PondCore"])
    ]
)
