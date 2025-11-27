package expo.modules.swipeable

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SwipePhysicsTest {

    @Test
    fun applyRubberBand_trailingOvershoot_returnsDampenedValue() {
        val result = SwipePhysics.applyRubberBand(
            translation = -150f,
            actionsWidth = 100f,
            isLeading = false
        )
        assertEquals(-116.67f, result, 0.01f)
    }

    @Test
    fun applyRubberBand_leadingOvershoot_returnsDampenedValue() {
        val result = SwipePhysics.applyRubberBand(
            translation = 150f,
            actionsWidth = 100f,
            isLeading = true
        )
        assertEquals(116.67f, result, 0.01f)
    }

    @Test
    fun applyRubberBand_withinBounds_returnsUnchanged() {
        val result = SwipePhysics.applyRubberBand(
            translation = -50f,
            actionsWidth = 100f,
            isLeading = false
        )
        assertEquals(-50f, result, 0.01f)
    }

    @Test
    fun applyRubberBand_wrongDirectionTrailing_returnsDampened() {
        val result = SwipePhysics.applyRubberBand(
            translation = 50f,
            actionsWidth = 100f,
            isLeading = false
        )
        assertEquals(16.67f, result, 0.01f)
    }

    @Test
    fun applyRubberBand_wrongDirectionLeading_returnsDampened() {
        val result = SwipePhysics.applyRubberBand(
            translation = -50f,
            actionsWidth = 100f,
            isLeading = true
        )
        assertEquals(-16.67f, result, 0.01f)
    }

    @Test
    fun calculateSnapDecision_velocityProjectsPastThreshold_opens() {
        val shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedPosition = -50f,
            thresholdDistance = 40f,
            isOpen = false,
            isLeading = false
        )
        assertTrue(shouldOpen)
    }

    @Test
    fun calculateSnapDecision_velocityProjectsBeforeThreshold_closes() {
        val shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedPosition = -30f,
            thresholdDistance = 40f,
            isOpen = false,
            isLeading = false
        )
        assertFalse(shouldOpen)
    }

    @Test
    fun calculateSnapDecision_leadingOpen_staysOpenAboveNegativeThreshold() {
        val shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedPosition = -30f,
            thresholdDistance = 40f,
            isOpen = true,
            isLeading = true
        )
        assertTrue(shouldOpen)
    }

    @Test
    fun calculateSnapDecision_leadingOpen_closesBelowNegativeThreshold() {
        val shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedPosition = -50f,
            thresholdDistance = 40f,
            isOpen = true,
            isLeading = true
        )
        assertFalse(shouldOpen)
    }

    @Test
    fun calculateProjectedPosition_appliesFrictionAndVelocity() {
        val result = SwipePhysics.projectFinalPosition(
            translation = 100f,
            velocity = 500f,
            friction = 0.5f
        )
        assertEquals(87.5f, result, 0.01f)
    }

    @Test
    fun calculateProjectedPosition_zeroVelocity_returnsFrictionedTranslation() {
        val result = SwipePhysics.projectFinalPosition(
            translation = 100f,
            velocity = 0f,
            friction = 0.8f
        )
        assertEquals(80f, result, 0.01f)
    }

    @Test
    fun calculateSpringVelocity_capsAtMaximum() {
        val result = SwipePhysics.calculateSpringVelocity(2000f)
        assertEquals(2000f, result, 0.01f)
    }

    @Test
    fun calculateSpringVelocity_scalesLowVelocity() {
        val result = SwipePhysics.calculateSpringVelocity(250f)
        assertEquals(500f, result, 0.01f)
    }

    @Test
    fun calculateSpringVelocity_zeroVelocity_returnsZero() {
        val result = SwipePhysics.calculateSpringVelocity(0f)
        assertEquals(0f, result, 0.01f)
    }

    @Test
    fun calculateSpringVelocity_negativeVelocity_preservesSign() {
        val result = SwipePhysics.calculateSpringVelocity(-2000f)
        assertEquals(-2000f, result, 0.01f)
    }

    @Test
    fun calculateSpringVelocity_negativeVelocity_scalesCorrectly() {
        val result = SwipePhysics.calculateSpringVelocity(-250f)
        assertEquals(-500f, result, 0.01f)
    }

    // MARK: - SwipeConstants Validation Tests

    @Test
    fun constants_rubberBandDivisorIsPositive() {
        assertTrue(SwipeConstants.RUBBER_BAND_DIVISOR > 0)
    }

    @Test
    fun constants_velocityNormalizerIsPositive() {
        assertTrue(SwipeConstants.VELOCITY_NORMALIZER > 0)
    }

    @Test
    fun constants_maxNormalizedVelocityIsPositive() {
        assertTrue(SwipeConstants.MAX_NORMALIZED_VELOCITY > 0)
    }

    @Test
    fun constants_velocityProjectionFactorInValidRange() {
        assertTrue(SwipeConstants.VELOCITY_PROJECTION_FACTOR > 0)
        assertTrue(SwipeConstants.VELOCITY_PROJECTION_FACTOR <= 1)
    }

    @Test
    fun constants_openDampingRatioInValidRange() {
        assertTrue(SwipeConstants.OPEN_DAMPING_RATIO > 0)
        assertTrue(SwipeConstants.OPEN_DAMPING_RATIO <= 1)
    }

    @Test
    fun constants_closeDampingRatioInValidRange() {
        assertTrue(SwipeConstants.CLOSE_DAMPING_RATIO > 0)
        assertTrue(SwipeConstants.CLOSE_DAMPING_RATIO <= 1)
    }

    @Test
    fun constants_progressChangeThresholdIsPositive() {
        assertTrue(SwipeConstants.PROGRESS_CHANGE_THRESHOLD > 0)
    }

    // MARK: - Edge Case Tests

    @Test
    fun applyRubberBand_zeroWidth_returnsDampenedValue() {
        val result = SwipePhysics.applyRubberBand(-50f, 0f, false)
        assertEquals(-50f / SwipeConstants.RUBBER_BAND_DIVISOR, result, 0.001f)
    }

    @Test
    fun applyRubberBand_zeroTranslation_returnsZero() {
        val result = SwipePhysics.applyRubberBand(0f, 80f, false)
        assertEquals(0f, result, 0.001f)
    }

    @Test
    fun calculateSnapDecision_zeroThreshold_opens() {
        val result = SwipePhysics.shouldSnapToOpen(-1f, 0f, false, false)
        assertTrue(result)
    }

    @Test
    fun calculateSnapDecision_fullThreshold_requiresFullSwipe() {
        val result = SwipePhysics.shouldSnapToOpen(-79f, 80f, false, false)
        assertFalse(result)
    }

    @Test
    fun calculateProjectedPosition_zeroFriction_returnsZero() {
        val result = SwipePhysics.projectFinalPosition(-50f, -500f, 0f)
        assertEquals(0f, result, 0.001f)
    }

    // MARK: - Recycling Behavior Tests (itemKey logic is tested here indirectly)
    // The actual itemKey prop handling is in SwipeableView and requires integration tests
    // These tests verify the underlying physics remain stable for recycling scenarios

    @Test
    fun recycling_resetState_rubberBandFromZero_returnsCorrectValue() {
        // After a reset (like recycling), translation starts at 0
        // This tests that starting a new swipe from zero works correctly
        val result = SwipePhysics.applyRubberBand(0f, 80f, false)
        assertEquals(0f, result, 0.001f)
    }

    @Test
    fun recycling_afterReset_newSwipeFromClosed_calculatesCorrectly() {
        // Simulates a new swipe after recycling reset
        val projectedPosition = SwipePhysics.projectFinalPosition(
            translation = -40f,
            velocity = -200f,
            friction = 1.0f
        )
        // Should be: -40 + (-200 * 0.15) = -40 + -30 = -70
        assertEquals(-70f, projectedPosition, 0.01f)
    }

    @Test
    fun recycling_afterReset_snapDecision_fromClosedState() {
        // After recycling, isOpen should be false - test snap decision from closed
        val shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedPosition = -50f,
            thresholdDistance = 32f, // 40% of 80
            isOpen = false,
            isLeading = false
        )
        assertTrue(shouldOpen)
    }

    @Test
    fun recycling_afterReset_snapDecision_insufficientSwipe() {
        // After recycling, a small swipe shouldn't open
        val shouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedPosition = -20f,
            thresholdDistance = 32f,
            isOpen = false,
            isLeading = false
        )
        assertFalse(shouldOpen)
    }
}
