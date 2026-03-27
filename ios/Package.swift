// swift-tools-version:5.4
import PackageDescription

let package = Package(
    name: "SwipeableActions",
    platforms: [.iOS(.v13), .macOS(.v10_15)],
    products: [
        .library(name: "SwipeableActions", targets: ["SwipeableActions"])
    ],
    targets: [
        .target(
            name: "SwipeableActions",
            path: ".",
            exclude: [
                "Tests",
                "SwipeableView.swift",
                "SwipeableModule.swift",
                "react-native-swipeable-actions.podspec"
            ],
            sources: ["SwipePhysics.swift", "SwipeAnimationConfig.swift"]
        ),
        .testTarget(
            name: "SwipeableActionsTests",
            dependencies: ["SwipeableActions"],
            path: "Tests"
        )
    ]
)
