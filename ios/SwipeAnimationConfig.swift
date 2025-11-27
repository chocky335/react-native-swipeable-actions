import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

/// Physics and animation constants for swipeable behavior.
///
/// Cross-platform constants (must match Android SwipeConstants.kt):
/// - rubberBandDivisor, velocityNormalizer, maxNormalizedVelocity
/// - velocityProjectionFactor, progressChangeThreshold, *Damping
///
/// Platform-specific: iOS uses duration-based animation, Android uses spring physics (stiffness).
/// Both produce similar visual results with critical damping (no oscillation).
enum SwipeAnimationConfig {
    // iOS-specific: duration-based animation (Android uses spring stiffness)
    static let openDuration: TimeInterval = 0.4
    static let closeDuration: TimeInterval = 0.3

    // Cross-platform constants - must match Android
    static let openDamping: CGFloat = 1.0   // Critical damping - no oscillation (matches Android)
    static let closeDamping: CGFloat = 1.0  // Critical damping - no oscillation (matches Android)
    static let rubberBandDivisor: CGFloat = 3.0
    static let velocityNormalizer: CGFloat = 500.0
    static let maxNormalizedVelocity: CGFloat = 2.0
    static let velocityProjectionFactor: CGFloat = 0.15
    static let progressChangeThreshold: CGFloat = 0.001
}
