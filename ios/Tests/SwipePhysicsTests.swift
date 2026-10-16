import XCTest
@testable import SwipeableActions

final class SwipePhysicsTests: XCTestCase {

    // MARK: - Rubber Band Tests

    func testRubberBandTrailingWithinBounds() {
        let result = SwipePhysics.applyRubberBand(
            translation: -60,
            actionsWidth: 80,
            isLeading: false
        )
        XCTAssertEqual(result, -60, accuracy: 0.001)
    }

    func testRubberBandTrailingOvershoot() {
        let result = SwipePhysics.applyRubberBand(
            translation: -100,
            actionsWidth: 80,
            isLeading: false
        )
        let expectedOvershoot = (100 - 80) / SwipeAnimationConfig.rubberBandDivisor
        XCTAssertEqual(result, -80 - expectedOvershoot, accuracy: 0.001)
    }

    func testRubberBandTrailingWrongDirection() {
        let result = SwipePhysics.applyRubberBand(
            translation: 20,
            actionsWidth: 80,
            isLeading: false
        )
        let expected = 20 / SwipeAnimationConfig.rubberBandDivisor
        XCTAssertEqual(result, expected, accuracy: 0.001)
    }

    func testRubberBandLeadingWithinBounds() {
        let result = SwipePhysics.applyRubberBand(
            translation: 60,
            actionsWidth: 80,
            isLeading: true
        )
        XCTAssertEqual(result, 60, accuracy: 0.001)
    }

    func testRubberBandLeadingOvershoot() {
        let result = SwipePhysics.applyRubberBand(
            translation: 100,
            actionsWidth: 80,
            isLeading: true
        )
        let expectedOvershoot = (100 - 80) / SwipeAnimationConfig.rubberBandDivisor
        XCTAssertEqual(result, 80 + expectedOvershoot, accuracy: 0.001)
    }

    func testRubberBandLeadingWrongDirection() {
        let result = SwipePhysics.applyRubberBand(
            translation: -10,
            actionsWidth: 80,
            isLeading: true
        )
        let expected = -10 / SwipeAnimationConfig.rubberBandDivisor
        XCTAssertEqual(result, expected, accuracy: 0.001)
    }

    // MARK: - Snap Decision Tests

    func testShouldOpenTrailingFromClosedSufficientSwipe() {
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -50,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: false,
            isCurrentlyOpen: false
        )
        XCTAssertTrue(shouldOpen)
    }

    func testShouldOpenTrailingFromClosedInsufficientSwipe() {
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -20,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: false,
            isCurrentlyOpen: false
        )
        XCTAssertFalse(shouldOpen)
    }

    func testShouldStayOpenTrailingWhenAlreadyOpen() {
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -10,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: false,
            isCurrentlyOpen: true
        )
        XCTAssertTrue(shouldOpen)
    }

    func testShouldCloseTrailingWhenSwipingBack() {
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: 50,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: false,
            isCurrentlyOpen: true
        )
        XCTAssertFalse(shouldOpen)
    }

    func testShouldOpenLeadingFromClosedSufficientSwipe() {
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: 50,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: true,
            isCurrentlyOpen: false
        )
        XCTAssertTrue(shouldOpen)
    }

    func testShouldOpenLeadingFromClosedInsufficientSwipe() {
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: 20,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: true,
            isCurrentlyOpen: false
        )
        XCTAssertFalse(shouldOpen)
    }

    // MARK: - Project Translation Tests

    func testProjectTranslationNoVelocity() {
        let projected = SwipePhysics.projectFinalPosition(
            translation: -60,
            velocity: 0,
            friction: 1.0
        )
        XCTAssertEqual(projected, -60, accuracy: 0.001)
    }

    func testProjectTranslationWithVelocity() {
        let projected = SwipePhysics.projectFinalPosition(
            translation: -60,
            velocity: -200,
            friction: 1.0
        )
        let expected = (-60 * 1.0) + (-200 * 1.0 * SwipeAnimationConfig.velocityProjectionFactor)
        XCTAssertEqual(projected, expected, accuracy: 0.001)
    }

    func testProjectTranslationWithFriction() {
        let projected = SwipePhysics.projectFinalPosition(
            translation: -60,
            velocity: -200,
            friction: 0.5
        )
        let expected = (-60 * 0.5) + (-200 * 0.5 * SwipeAnimationConfig.velocityProjectionFactor)
        XCTAssertEqual(projected, expected, accuracy: 0.001)
    }

    // MARK: - Spring Velocity Tests

    func testSpringVelocityZeroInput() {
        let velocity = SwipePhysics.calculateSpringVelocity(from: 0)
        XCTAssertEqual(velocity, 0, accuracy: 0.001)
    }

    func testSpringVelocityNormalInput() {
        let velocity = SwipePhysics.calculateSpringVelocity(from: 500)
        let expected = 500 / SwipeAnimationConfig.velocityNormalizer
        XCTAssertEqual(velocity, expected, accuracy: 0.001)
    }

    func testSpringVelocityCappedAtMax() {
        let velocity = SwipePhysics.calculateSpringVelocity(from: 2000)
        XCTAssertEqual(velocity, SwipeAnimationConfig.maxNormalizedVelocity, accuracy: 0.001)
    }

    func testSpringVelocityNegativeInput() {
        let velocity = SwipePhysics.calculateSpringVelocity(from: -500)
        let expected = 500 / SwipeAnimationConfig.velocityNormalizer
        XCTAssertEqual(velocity, expected, accuracy: 0.001)
    }

    // MARK: - Animation Config Validation Tests

    func testOpenDurationIsPositive() {
        XCTAssertGreaterThan(SwipeAnimationConfig.openDuration, 0)
    }

    func testCloseDurationIsPositive() {
        XCTAssertGreaterThan(SwipeAnimationConfig.closeDuration, 0)
    }

    func testOpenDampingInValidRange() {
        XCTAssertGreaterThan(SwipeAnimationConfig.openDamping, 0)
        XCTAssertLessThanOrEqual(SwipeAnimationConfig.openDamping, 1)
    }

    func testCloseDampingInValidRange() {
        XCTAssertGreaterThan(SwipeAnimationConfig.closeDamping, 0)
        XCTAssertLessThanOrEqual(SwipeAnimationConfig.closeDamping, 1)
    }

    func testRubberBandDivisorIsPositive() {
        XCTAssertGreaterThan(SwipeAnimationConfig.rubberBandDivisor, 0)
    }

    func testVelocityDivisorIsPositive() {
        XCTAssertGreaterThan(SwipeAnimationConfig.velocityNormalizer, 0)
    }

    func testMaxSpringVelocityIsPositive() {
        XCTAssertGreaterThan(SwipeAnimationConfig.maxNormalizedVelocity, 0)
    }

    func testVelocityProjectionFactorInValidRange() {
        XCTAssertGreaterThan(SwipeAnimationConfig.velocityProjectionFactor, 0)
        XCTAssertLessThanOrEqual(SwipeAnimationConfig.velocityProjectionFactor, 1)
    }

    func testProgressChangeThresholdIsPositive() {
        XCTAssertGreaterThan(SwipeAnimationConfig.progressChangeThreshold, 0)
    }

    // MARK: - Edge Case Tests

    func testRubberBandZeroWidth() {
        // With zero width, all translation is overshoot and gets rubber-banded
        let result = SwipePhysics.applyRubberBand(
            translation: -50,
            actionsWidth: 0,
            isLeading: false
        )
        let expected = -50 / SwipeAnimationConfig.rubberBandDivisor
        XCTAssertEqual(result, expected, accuracy: 0.001)
    }

    func testRubberBandZeroTranslation() {
        let result = SwipePhysics.applyRubberBand(
            translation: 0,
            actionsWidth: 80,
            isLeading: false
        )
        XCTAssertEqual(result, 0, accuracy: 0.001)
    }

    func testShouldOpenZeroThreshold() {
        let result = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -1,
            actionsWidth: 80,
            threshold: 0,
            isLeading: false,
            isCurrentlyOpen: false
        )
        XCTAssertTrue(result)
    }

    func testShouldOpenFullThreshold() {
        let result = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -79,
            actionsWidth: 80,
            threshold: 1.0,
            isLeading: false,
            isCurrentlyOpen: false
        )
        XCTAssertFalse(result)
    }

    func testProjectTranslationZeroFriction() {
        let result = SwipePhysics.projectFinalPosition(
            translation: -50,
            velocity: -500,
            friction: 0
        )
        XCTAssertEqual(result, 0, accuracy: 0.001)
    }

    // MARK: - Recycling Behavior Tests
    // itemKey prop handling is in SwipeableView and requires integration tests.
    // These tests verify the underlying physics remain stable for recycling scenarios.

    func testRecyclingResetStateRubberBandFromZero() {
        // After a reset (like recycling), translation starts at 0
        let result = SwipePhysics.applyRubberBand(
            translation: 0,
            actionsWidth: 80,
            isLeading: false
        )
        XCTAssertEqual(result, 0, accuracy: 0.001)
    }

    func testRecyclingAfterResetNewSwipeFromClosed() {
        // Simulates a new swipe after recycling reset
        let projected = SwipePhysics.projectFinalPosition(
            translation: -40,
            velocity: -200,
            friction: 1.0
        )
        // Should be: -40 + (-200 * velocityProjectionFactor)
        let expected = -40 + (-200 * SwipeAnimationConfig.velocityProjectionFactor)
        XCTAssertEqual(projected, expected, accuracy: 0.001)
    }

    func testRecyclingAfterResetSnapDecisionFromClosedState() {
        // After recycling, isOpen should be false - test snap decision from closed
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -50,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: false,
            isCurrentlyOpen: false
        )
        XCTAssertTrue(shouldOpen)
    }

    func testRecyclingAfterResetSnapDecisionInsufficientSwipe() {
        // After recycling, a small swipe shouldn't open
        let shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: -20,
            actionsWidth: 80,
            threshold: 0.4,
            isLeading: false,
            isCurrentlyOpen: false
        )
        XCTAssertFalse(shouldOpen)
    }
}

final class TwoSidedSwipePhysicsTests: XCTestCase {
    private final class CommandProbe {
        var workGeneration = 0
        var received: [String] = []

        func receive(_ command: String) {
            workGeneration += 1
            received.append(command)
        }
    }

    func testSameBindingCommandsExecuteInOrderDespiteWorkGenerationChanges() {
        let sequences = [
            ["open", "close(false)"],
            ["close", "open"],
            ["open(left)", "open(right)"],
            ["open(left)", "open(right)", "closeAll"]
        ]
        for sequence in sequences {
            let view = CommandProbe()
            let current = SwipeCommandTarget(view)
            // Capture every target before executing the first command, as in a JS turn.
            let queued = sequence.map { command in
                { current.perform(ifCurrent: current) { $0.receive(command) } }
            }
            queued.forEach { $0() }
            XCTAssertEqual(view.received, sequence)
            XCTAssertEqual(view.received.last, sequence.last)
            XCTAssertEqual(view.workGeneration, sequence.count)
        }
    }

    func testQueuedCommandRejectsOldBindingAfterAToBToAOnSameView() {
        let view = CommandProbe()
        let firstA = SwipeCommandTarget(view)
        var registry = ["a": firstA]
        let queued = { firstA.perform(ifCurrent: registry["a"]) { $0.receive("stale open") } }
        registry.removeValue(forKey: "a")
        registry["b"] = SwipeCommandTarget(view)
        registry.removeValue(forKey: "b")
        registry["a"] = SwipeCommandTarget(view)
        queued()
        XCTAssertTrue(view.received.isEmpty)
        registry["a"]?.perform(ifCurrent: registry["a"]) { $0.receive("fresh close") }
        XCTAssertEqual(view.received, ["fresh close"])
    }

    func testQueuedCommandRejectsReattachmentAndReplacementBindings() {
        let originalView = CommandProbe()
        let oldBinding = SwipeCommandTarget(originalView)
        oldBinding.perform(ifCurrent: nil) { $0.receive("detached") }
        oldBinding.perform(ifCurrent: SwipeCommandTarget(originalView)) { $0.receive("reattached") }
        let replacementView = CommandProbe()
        oldBinding.perform(ifCurrent: SwipeCommandTarget(replacementView)) { $0.receive("replaced") }
        XCTAssertTrue(originalView.received.isEmpty)
        XCTAssertTrue(replacementView.received.isEmpty)
    }

    func testQueuedCommandDoesNotRetainUnmountedView() {
        var view: CommandProbe? = CommandProbe()
        let target = SwipeCommandTarget(view!)
        weak var weakView = view
        view = nil
        XCTAssertNil(weakView)
        target.perform(ifCurrent: target) { _ in XCTFail("Deallocated view received a command") }
    }

    func testCloseAllIncludesClosingLegOfOppositeSideOpen() {
        XCTAssertTrue(SwipePhysics.shouldCloseForCloseAll(
            isOpen: false, isAnimating: true, hasPendingInteraction: false
        ))
        XCTAssertTrue(SwipePhysics.shouldCloseForCloseAll(
            isOpen: false, isAnimating: false, hasPendingInteraction: true
        ))
        XCTAssertFalse(SwipePhysics.shouldCloseForCloseAll(
            isOpen: false, isAnimating: false, hasPendingInteraction: false
        ))
    }

    func testCloseAllIncludesPendingWorkForEveryRow() {
        for isAnimating in [false, true] {
            for pending in [false, true] {
                XCTAssertEqual(isAnimating || pending, SwipePhysics.shouldCloseForCloseAll(
                    isOpen: false, isAnimating: isAnimating, hasPendingInteraction: pending
                ))
                XCTAssertTrue(SwipePhysics.shouldCloseForCloseAll(
                    isOpen: true, isAnimating: isAnimating, hasPendingInteraction: pending
                ))
            }
        }
    }

    func testPhysicalSideSelectionAndDisabledEdges() {
        XCTAssertEqual(SwipePhysics.latchedSide(openSide: nil, translation: 1, leftWidth: 80, rightWidth: 120), .left)
        XCTAssertEqual(SwipePhysics.latchedSide(openSide: nil, translation: -1, leftWidth: 80, rightWidth: 120), .right)
        XCTAssertNil(SwipePhysics.latchedSide(openSide: nil, translation: 0, leftWidth: 80, rightWidth: 120))
        XCTAssertNil(SwipePhysics.latchedSide(openSide: nil, translation: 50, leftWidth: 0, rightWidth: 120))
        XCTAssertNil(SwipePhysics.latchedSide(openSide: nil, translation: -50, leftWidth: 80, rightWidth: .infinity))
    }

    func testOpenSideStaysLatchedThroughDirectionReversal() {
        for side in SwipeSide.allCases {
            XCTAssertEqual(SwipePhysics.latchedSide(openSide: side, translation: -side.sign * 200, leftWidth: 80, rightWidth: 120), side)
            XCTAssertEqual(SwipePhysics.constrainToSide(translation: -side.sign * 100, actionsWidth: 80, side: side), 0)
        }
        XCTAssertNil(SwipePhysics.latchedSide(openSide: .left, translation: -100, leftWidth: 0, rightWidth: 120))
    }

    func testUnequalWidthsRubberBandIndependently() {
        XCTAssertEqual(SwipePhysics.constrainToSide(translation: 110, actionsWidth: 80, side: .left), 90)
        XCTAssertEqual(SwipePhysics.constrainToSide(translation: -150, actionsWidth: 120, side: .right), -130)
        XCTAssertEqual(SwipePhysics.constrainToSide(translation: -100, actionsWidth: 120, side: .right), -100)
        XCTAssertEqual(SwipePhysics.constrainToSide(translation: 50, actionsWidth: 0, side: .left), 0)
    }

    func testMirroredReleaseVectorsPreserveRelativeDisplacement() {
        // Magnitudes are in the opening direction; closing displacement/velocity are negative.
        let vectors: [(CGFloat, CGFloat, CGFloat, CGFloat, Bool, Bool)] = [
            (80, 32, 0, 1, false, false),
            (80, 33, 0, 1, false, true),
            (120, 48, 0, 1, false, false),
            (120, 49, 0, 1, false, true),
            (80, 0, 220, 1, false, true),
            (120, 0, 220, 1, false, false),
            (80, 60, 0, 0.5, false, false),
            (80, 66, 0, 0.5, false, true),
            (80, -31, 0, 1, true, true),
            (80, -32, 0, 1, true, false),
            (120, -47, 0, 1, true, true),
            (120, -48, 0, 1, true, false),
            (80, 0, -220, 1, true, false),
            (80, -50, 0, 0.5, true, true),
            (80, -66, 0, 0.5, true, false),
            (80, 100, 500, 0, false, false),
            (80, -100, -500, 0, true, true)
        ]
        for side in SwipeSide.allCases {
            for (width, translation, velocity, friction, startingOpen, expected) in vectors {
                XCTAssertEqual(SwipePhysics.shouldOpenOnSide(
                    translation: side.sign * translation, velocity: side.sign * velocity,
                    friction: friction, actionsWidth: width, threshold: 0.4,
                    side: side, isCurrentlyOpen: startingOpen
                ), expected, "\(side), width \(width), displacement \(translation), startingOpen \(startingOpen)")
            }
        }
    }

    func testOpenRowStartOffsetIsAppliedOnlyToRendering() {
        for side in SwipeSide.allCases {
            let start = side.sign * 80
            let relative = -side.sign * 40
            XCTAssertEqual(SwipePhysics.constrainToSide(translation: start + relative, actionsWidth: 80, side: side), side.sign * 40)
            XCTAssertFalse(SwipePhysics.shouldOpenOnSide(
                translation: relative, velocity: 0, friction: 1, actionsWidth: 80,
                threshold: 0.4, side: side, isCurrentlyOpen: true
            ))
        }
    }

    func testNewWidthsRejectNonfiniteAndNonpositiveValues() {
        for width: CGFloat in [0, -1, .nan, .infinity, -.infinity] {
            XCTAssertEqual(SwipePhysics.validWidth(width), 0)
        }
        XCTAssertEqual(SwipePhysics.validWidth(80), 80)
    }

    func testIncompleteTwoSidedSlotsNeverHaveContentRole() {
        for count in [0, 1, 2, 4] { XCTAssertNil(SwipePhysics.childRoles(count: count)) }
        let roles = SwipePhysics.childRoles(count: 3)
        XCTAssertEqual(roles?.left, 0)
        XCTAssertEqual(roles?.right, 1)
        XCTAssertEqual(roles?.content, 2)
        XCTAssertNotEqual(roles?.left, roles?.right)
    }

    func testSingleSideRowsRequireTheSameCompleteChildProtocol() {
        XCTAssertNil(SwipePhysics.childRoles(count: 0))
        XCTAssertNil(SwipePhysics.childRoles(count: 1))
        XCTAssertNil(SwipePhysics.childRoles(count: 2))
        XCTAssertNil(SwipePhysics.childRoles(count: 4))
        let roles = SwipePhysics.childRoles(count: 3)
        XCTAssertEqual(roles?.left, 0)
        XCTAssertEqual(roles?.right, 1)
        XCTAssertEqual(roles?.content, 2)
    }

    func testCacheRestoresExactSideAndEvictsOldestOpenKey() {
        var cache = SwipeOpenStateCache(capacity: 2)
        cache.set(.left, for: "a")
        cache.set(.right, for: "b")
        XCTAssertEqual(cache.side(for: "a"), .left)
        XCTAssertEqual(cache.side(for: "b"), .right)
        cache.set(.right, for: "a")
        cache.set(.left, for: "c")
        XCTAssertNil(cache.side(for: "a"))
        XCTAssertEqual(cache.side(for: "b"), .right)
        XCTAssertEqual(cache.side(for: "c"), .left)
    }

    func testClosingAndReopeningDoesNotLeaveDuplicateEvictionEntries() {
        var cache = SwipeOpenStateCache(capacity: 2)
        for _ in 0..<10 {
            cache.set(.left, for: "a")
            cache.set(nil, for: "a")
        }
        cache.set(.right, for: "b")
        cache.set(.left, for: "a")
        XCTAssertEqual(cache.side(for: "b"), .right)
        XCTAssertEqual(cache.side(for: "a"), .left)
        cache.set(.right, for: "c")
        XCTAssertNil(cache.side(for: "b"))
        XCTAssertEqual(cache.side(for: "a"), .left)
    }

    func testFeedbackOnlyOnFirstOpeningThresholdCrossing() {
        var feedback = SwipeFeedbackState()
        feedback.activate(progress: 0, threshold: 0.4)
        XCTAssertFalse(feedback.update(progress: 0.4, threshold: 0.4))
        XCTAssertTrue(feedback.update(progress: 0.41, threshold: 0.4))
        XCTAssertFalse(feedback.update(progress: 0.8, threshold: 0.4))
        XCTAssertFalse(feedback.update(progress: 0.1, threshold: 0.4))
        XCTAssertFalse(feedback.update(progress: 0.9, threshold: 0.4))
    }

    func testStartingOpenDoesNotFabricateOpeningCrossing() {
        var feedback = SwipeFeedbackState()
        feedback.activate(progress: 1, threshold: 0.4)
        XCTAssertFalse(feedback.update(progress: 0.8, threshold: 0.4))
        XCTAssertFalse(feedback.update(progress: 0.3, threshold: 0.4))
        XCTAssertTrue(feedback.update(progress: 0.5, threshold: 0.4))
    }

    func testFeedbackResetCancelsAndRearmsForNextGesture() {
        var feedback = SwipeFeedbackState()
        XCTAssertFalse(feedback.update(progress: 1, threshold: 0.4))
        feedback.activate(progress: 0, threshold: 0.4)
        XCTAssertTrue(feedback.update(progress: 1, threshold: 0.4))
        feedback.reset()
        XCTAssertFalse(feedback.update(progress: 1, threshold: 0.4))
        XCTAssertFalse(feedback.hasCrossedThreshold)
        feedback.activate(progress: 0, threshold: 0.4)
        XCTAssertTrue(feedback.update(progress: 1, threshold: 0.4))
    }

    func testHapticsFollowOpeningIntentWhenStartingOpenOnEitherEdge() {
        for side in SwipeSide.allCases {
            for width: CGFloat in [80, 120] {
                var feedback = SwipeFeedbackState()
                feedback.activate(isOpening: true)
                let boundary = -width * 0.4
                let vectors: [(CGFloat, Bool)] = [
                    (-1, false), (boundary, false), (boundary - 8, false),
                    (boundary - 1, false), (boundary + 1, true),
                    (boundary - 1, false), (boundary + 1, false)
                ]
                for (relative, expectedImpact) in vectors {
                    let intent = SwipePhysics.shouldSnapToOpen(
                        projectedTranslation: side.sign * relative, actionsWidth: width,
                        threshold: 0.4, isLeading: side == .left, isCurrentlyOpen: true
                    )
                    XCTAssertEqual(feedback.update(isOpening: intent), expectedImpact)
                }
            }
        }
    }

    func testWrongDirectionLegacyDirectDragDoesNotTriggerOpeningFeedback() {
        for side in SwipeSide.allCases {
            var feedback = SwipeFeedbackState()
            feedback.activate(isOpening: false)
            let intent = SwipePhysics.shouldSnapToOpen(
                projectedTranslation: -side.sign * 200, actionsWidth: 80,
                threshold: 0.4, isLeading: side == .left, isCurrentlyOpen: false
            )
            XCTAssertFalse(feedback.update(isOpening: intent))
        }
    }

    func testAppearanceEntryPopAndSettling() {
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 0, popElapsed: nil, hasPopped: false, reduceMotion: false), 0.96)
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 1, popElapsed: nil, hasPopped: false, reduceMotion: false), 1)
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 0.5, popElapsed: 0.12, hasPopped: true, reduceMotion: false), 1.03)
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 0.5, popElapsed: 1, hasPopped: true, reduceMotion: false), 1)
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 0, popElapsed: nil, hasPopped: true, reduceMotion: false), 1)
    }

    func testReduceMotionSuppressesBothEntryAndActivePop() {
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 0, popElapsed: nil, hasPopped: false, reduceMotion: true), 1)
        XCTAssertEqual(SwipeAnimationConfig.actionRailScale(progress: 0.5, popElapsed: 0.12, hasPopped: true, reduceMotion: true), 1)
    }
}
