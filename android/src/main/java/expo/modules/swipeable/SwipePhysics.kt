package expo.modules.swipeable

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign

enum class SwipeSide(val value: String, val sign: Float) {
    LEFT("left", 1f), RIGHT("right", -1f);

    companion object {
        fun fromValue(value: String?): SwipeSide? = values().firstOrNull { it.value == value }
    }
}

object SwipePhysics {
    private fun enabled(width: Float): Boolean = width.isFinite() && width > 0f

    fun defaultOpenSide(leftWidth: Float, rightWidth: Float): SwipeSide? {
        return when {
            enabled(rightWidth) -> SwipeSide.RIGHT
            enabled(leftWidth) -> SwipeSide.LEFT
            else -> null
        }
    }

    /** Physical edge selection; an existing latch cannot change until the next gesture. */
    fun selectSide(
        translation: Float,
        openSide: SwipeSide?,
        latchedSide: SwipeSide?,
        leftWidth: Float,
        rightWidth: Float
    ): SwipeSide? {
        val side = latchedSide ?: openSide ?: when {
            translation > 0f -> SwipeSide.LEFT
            translation < 0f -> SwipeSide.RIGHT
            else -> return null
        }
        return side.takeIf { enabled(if (it == SwipeSide.LEFT) leftWidth else rightWidth) }
    }

    fun applyLatchedTranslation(startOffset: Float, translation: Float, friction: Float, width: Float, side: SwipeSide): Float {
        val raw = startOffset + translation * friction
        val clamped = if (side == SwipeSide.LEFT) maxOf(0f, raw) else minOf(0f, raw)
        return applyRubberBand(clamped, width, side == SwipeSide.LEFT)
    }

    fun applyRubberBand(
        translation: Float,
        actionsWidth: Float,
        isLeading: Boolean
    ): Float {
        var result = translation
        if (isLeading) {
            when {
                result > actionsWidth -> {
                    result = actionsWidth + ((result - actionsWidth) / SwipeConstants.RUBBER_BAND_DIVISOR)
                }
                result < 0f -> {
                    result /= SwipeConstants.RUBBER_BAND_DIVISOR
                }
            }
        } else {
            when {
                result < -actionsWidth -> {
                    result = -actionsWidth - ((abs(result) - actionsWidth) / SwipeConstants.RUBBER_BAND_DIVISOR)
                }
                result > 0f -> {
                    result /= SwipeConstants.RUBBER_BAND_DIVISOR
                }
            }
        }
        return result
    }

    fun shouldSnapToOpen(
        projectedPosition: Float,
        thresholdDistance: Float,
        isOpen: Boolean,
        isLeading: Boolean
    ): Boolean {
        return if (isLeading) {
            if (isOpen) projectedPosition > -thresholdDistance else projectedPosition > thresholdDistance
        } else {
            if (isOpen) projectedPosition < thresholdDistance else projectedPosition < -thresholdDistance
        }
    }

    fun projectFinalPosition(
        translation: Float,
        velocity: Float,
        friction: Float
    ): Float {
        return (translation * friction) + (velocity * friction * SwipeConstants.VELOCITY_PROJECTION_FACTOR)
    }

    fun calculateSpringVelocity(gestureVelocity: Float): Float {
        // Preserve the sign of the velocity - critical for correct spring animation direction
        val magnitude = min(
            abs(gestureVelocity) / SwipeConstants.VELOCITY_NORMALIZER,
            SwipeConstants.MAX_NORMALIZED_VELOCITY
        ) * SwipeConstants.VELOCITY_SCALE
        return sign(gestureVelocity) * magnitude
    }
}
