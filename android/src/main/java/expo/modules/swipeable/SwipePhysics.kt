package expo.modules.swipeable

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign

object SwipePhysics {

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
