import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

struct SwipePhysics {

    static func applyRubberBand(
        translation: CGFloat,
        actionsWidth: CGFloat,
        isLeading: Bool
    ) -> CGFloat {
        let divisor = SwipeAnimationConfig.rubberBandDivisor

        if isLeading {
            if translation > actionsWidth {
                return actionsWidth + ((translation - actionsWidth) / divisor)
            } else if translation < 0 {
                return translation / divisor
            }
        } else {
            if translation < -actionsWidth {
                return -actionsWidth - ((abs(translation) - actionsWidth) / divisor)
            } else if translation > 0 {
                return translation / divisor
            }
        }
        return translation
    }

    static func shouldSnapToOpen(
        projectedTranslation: CGFloat,
        actionsWidth: CGFloat,
        threshold: CGFloat,
        isLeading: Bool,
        isCurrentlyOpen: Bool
    ) -> Bool {
        let thresholdDistance = actionsWidth * threshold

        if isLeading {
            return isCurrentlyOpen
                ? projectedTranslation > -thresholdDistance
                : projectedTranslation > thresholdDistance
        } else {
            return isCurrentlyOpen
                ? projectedTranslation < thresholdDistance
                : projectedTranslation < -thresholdDistance
        }
    }

    static func projectFinalPosition(
        translation: CGFloat,
        velocity: CGFloat,
        friction: CGFloat
    ) -> CGFloat {
        let factor = SwipeAnimationConfig.velocityProjectionFactor
        return (translation * friction) + (velocity * friction * factor)
    }

    static func calculateSpringVelocity(from gestureVelocity: CGFloat) -> CGFloat {
        guard abs(gestureVelocity) > 0 else { return 0 }
        let normalizer = SwipeAnimationConfig.velocityNormalizer
        let maxVelocity = SwipeAnimationConfig.maxNormalizedVelocity
        return min(abs(gestureVelocity) / normalizer, maxVelocity)
    }
}
