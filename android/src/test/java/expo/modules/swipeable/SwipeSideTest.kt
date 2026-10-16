package expo.modules.swipeable

import org.junit.Assert.*
import org.junit.Test

class SwipeSideTest {
    @Test fun physicalDirectionSelectsIndependentWidths() {
        assertEquals(SwipeSide.LEFT, select(20f))
        assertEquals(SwipeSide.RIGHT, select(-20f))
        assertNull(select(0f))
    }

    @Test fun disabledAndInvalidEdgesNeverFallBackDuringGesture() {
        for (width in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY)) {
            assertNull(SwipePhysics.selectSide(20f, null, null, width, 120f))
            assertNull(SwipePhysics.selectSide(-20f, null, null, 80f, width))
        }
    }

    @Test fun latchSurvivesDirectionReversal() {
        assertEquals(SwipeSide.LEFT, select(-200f, latched = SwipeSide.LEFT))
        assertEquals(SwipeSide.RIGHT, select(200f, latched = SwipeSide.RIGHT))
    }

    @Test fun openRowLatchesItsCurrentEdge() {
        assertEquals(SwipeSide.LEFT, select(-200f, open = SwipeSide.LEFT))
        assertEquals(SwipeSide.RIGHT, select(200f, open = SwipeSide.RIGHT))
    }

    @Test fun removedLatchedEdgeCannotBecomeTheOppositeEdge() {
        assertNull(SwipePhysics.selectSide(-40f, null, SwipeSide.LEFT, 0f, 120f))
        assertNull(SwipePhysics.selectSide(40f, SwipeSide.RIGHT, null, 80f, 0f))
    }

    @Test fun defaultOpenUsesRightThenLeftThenNoEnabledEdge() {
        assertEquals(SwipeSide.RIGHT, SwipePhysics.defaultOpenSide(80f, 120f))
        assertEquals(SwipeSide.LEFT, SwipePhysics.defaultOpenSide(80f, 0f))
        assertEquals(SwipeSide.RIGHT, SwipePhysics.defaultOpenSide(0f, 120f))
        assertNull(SwipePhysics.defaultOpenSide(0f, 0f))
    }

    @Test fun closingAcrossZeroClampsBothEdges() {
        assertEquals(0f, SwipePhysics.applyLatchedTranslation(80f, -200f, 1f, 80f, SwipeSide.LEFT), 0f)
        assertEquals(0f, SwipePhysics.applyLatchedTranslation(-120f, 200f, 1f, 120f, SwipeSide.RIGHT), 0f)
    }

    @Test fun startingOffsetAndFrictionApplyExactlyOnce() {
        assertEquals(60f, SwipePhysics.applyLatchedTranslation(80f, -40f, .5f, 80f, SwipeSide.LEFT), 0f)
        assertEquals(-100f, SwipePhysics.applyLatchedTranslation(-120f, 40f, .5f, 120f, SwipeSide.RIGHT), 0f)
    }

    @Test fun unequalWidthsRetainRubberBandPhysics() {
        assertEquals(100f, SwipePhysics.applyLatchedTranslation(0f, 140f, 1f, 80f, SwipeSide.LEFT), .001f)
        assertEquals(-140f, SwipePhysics.applyLatchedTranslation(0f, -180f, 1f, 120f, SwipeSide.RIGHT), .001f)
    }

    @Test fun releaseUsesRelativeDisplacementForAlreadyOpenRows() {
        for (side in SwipeSide.values()) {
            val width = if (side == SwipeSide.LEFT) 80f else 120f
            val smallClosingDrag = -side.sign * width * .2f
            val largeClosingDrag = -side.sign * width * .6f
            assertTrue(SwipePhysics.shouldSnapToOpen(smallClosingDrag, width * .4f, true, side == SwipeSide.LEFT))
            assertFalse(SwipePhysics.shouldSnapToOpen(largeClosingDrag, width * .4f, true, side == SwipeSide.LEFT))
        }
    }

    @Test fun mirroredThresholdVelocityAndFrictionVectors() {
        for (side in SwipeSide.values()) {
            val leading = side == SwipeSide.LEFT
            assertFalse(SwipePhysics.shouldSnapToOpen(side.sign * 40f, 40f, false, leading))
            assertTrue(SwipePhysics.shouldSnapToOpen(side.sign * 40.01f, 40f, false, leading))
            assertFalse(SwipePhysics.shouldSnapToOpen(-side.sign * 40f, 40f, true, leading))
            val projected = SwipePhysics.projectFinalPosition(side.sign * 30f, side.sign * 400f, .5f)
            assertEquals(side.sign * 45f, projected, .001f)
            assertTrue(SwipePhysics.shouldSnapToOpen(projected, 40f, false, leading))
        }
    }

    @Test fun invalidSideNamesStayInvalid() {
        assertNull(SwipeSide.fromValue("leading"))
        assertNull(SwipeSide.fromValue(null))
        assertEquals(SwipeSide.LEFT, SwipeSide.fromValue("left"))
    }

    private fun select(delta: Float, open: SwipeSide? = null, latched: SwipeSide? = null) =
        SwipePhysics.selectSide(delta, open, latched, 80f, 120f)
}
