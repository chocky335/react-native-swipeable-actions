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
