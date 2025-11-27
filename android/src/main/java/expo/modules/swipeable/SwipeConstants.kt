package expo.modules.swipeable

/**
 * Physics and animation constants for swipeable behavior.
 *
 * Cross-platform constants (must match iOS SwipeAnimationConfig.swift):
 * - RUBBER_BAND_DIVISOR, VELOCITY_NORMALIZER, MAX_NORMALIZED_VELOCITY
 * - VELOCITY_PROJECTION_FACTOR, PROGRESS_CHANGE_THRESHOLD, *_DAMPING_RATIO
 *
 * Platform-specific: Android uses spring physics (stiffness), iOS uses duration-based animation.
 * Both produce similar visual results with critical damping (no oscillation).
 */
object SwipeConstants {
    // Cross-platform constants - must match iOS
    const val RUBBER_BAND_DIVISOR = 3f
    const val VELOCITY_NORMALIZER = 500f
    const val MAX_NORMALIZED_VELOCITY = 2.0f
    const val VELOCITY_PROJECTION_FACTOR = 0.15f
    const val PROGRESS_CHANGE_THRESHOLD = 0.001f

    // Android-specific: velocity conversion
    const val VELOCITY_SCALE = 1000f

    // Android-specific: spring physics (iOS uses duration-based animation)
    const val OPEN_STIFFNESS = 300f
    const val OPEN_DAMPING_RATIO = 1.0f  // Critical damping - no oscillation (matches iOS)
    const val CLOSE_STIFFNESS = 400f
    const val CLOSE_DAMPING_RATIO = 1.0f  // Critical damping - no oscillation (matches iOS)
}
