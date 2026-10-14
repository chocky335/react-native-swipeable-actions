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

enum SwipeSide: String, CaseIterable {
    case left
    case right

    var sign: CGFloat { self == .left ? 1 : -1 }
}

/// An immutable registry binding. Its identity changes only when a view is
/// registered again, never when an earlier command interrupts animation work.
final class SwipeCommandTarget<View: AnyObject> {
    weak var value: View?
    let identity: ObjectIdentifier

    init(_ value: View) {
        self.value = value
        identity = ObjectIdentifier(value)
    }

    func perform(ifCurrent current: SwipeCommandTarget<View>?, _ command: (View) -> Void) {
        guard self === current, let view = value else { return }
        command(view)
    }
}

/// Only open targets are cached. Closing removes the FIFO entry as well as its value.
struct SwipeOpenStateCache {
    let capacity: Int
    private var sides: [String: SwipeSide] = [:]
    private var order: [String] = []

    init(capacity: Int) {
        self.capacity = capacity
    }

    func side(for key: String) -> SwipeSide? { sides[key] }

    // Call while holding the registry queue: capture and cache clearing must be atomic.
    // An unbound close has no delayed work that could affect a future binding.
    mutating func captureCloseTarget<View: AnyObject>(
        for key: String, current: SwipeCommandTarget<View>?
    ) -> SwipeCommandTarget<View>? {
        guard current?.value != nil else {
            set(nil, for: key)
            return nil
        }
        return current
    }

    mutating func clearIfUnbound(for key: String, hasCurrentBinding: Bool) {
        guard !hasCurrentBinding else { return }
        set(nil, for: key)
    }

    mutating func set(_ side: SwipeSide?, for key: String) {
        guard let side = side else {
            sides.removeValue(forKey: key)
            order.removeAll { $0 == key }
            return
        }
        if sides[key] == nil { order.append(key) }
        sides[key] = side
        while order.count > max(0, capacity) {
            sides.removeValue(forKey: order.removeFirst())
        }
    }
}

/// Only Fabric's mount/unmount hooks participate in role assignment.
struct SwipeReactChildren<Child: AnyObject> {
    private(set) var views: [Child] = []

    mutating func mount(_ child: Child, at index: Int) {
        views.removeAll { $0 === child }
        views.insert(child, at: min(max(index, 0), views.count))
    }

    mutating func unmount(_ child: Child, at index: Int) {
        if views.indices.contains(index), views[index] === child {
            views.remove(at: index)
        } else {
            views.removeAll { $0 === child }
        }
    }
}

struct SwipeChildRoles: Equatable {
    let left: Int?
    let right: Int?
    let actions: Int?
    let content: Int
}

protocol SwipeChildVisibility: AnyObject {
    var isHidden: Bool { get set }
    var isUserInteractionEnabled: Bool { get set }
    var accessibilityElementsHidden: Bool { get set }
}

/// Return native-owned rail flags before Fabric reuses a shell as arbitrary content.
/// Keep the caller's original values; unowned content must not be forcibly unhidden.
final class SwipeRailVisibility {
    private struct State {
        weak var view: SwipeChildVisibility?
        let isHidden: Bool
        let isUserInteractionEnabled: Bool
        let accessibilityElementsHidden: Bool

        init(_ view: SwipeChildVisibility) {
            self.view = view
            isHidden = view.isHidden
            isUserInteractionEnabled = view.isUserInteractionEnabled
            accessibilityElementsHidden = view.accessibilityElementsHidden
        }

        func restore() {
            view?.isHidden = isHidden
            view?.isUserInteractionEnabled = isUserInteractionEnabled
            view?.accessibilityElementsHidden = accessibilityElementsHidden
        }
    }

    private var states: [ObjectIdentifier: State] = [:]

    func setRevealed(_ revealed: Bool, for view: SwipeChildVisibility) {
        let identity = ObjectIdentifier(view)
        if states[identity]?.view !== view { states[identity] = State(view) }
        view.isHidden = !revealed
        view.isUserInteractionEnabled = revealed
        view.accessibilityElementsHidden = !revealed
    }

    func release(_ view: SwipeChildVisibility) {
        guard let state = states.removeValue(forKey: ObjectIdentifier(view)),
              state.view === view else { return }
        state.restore()
    }

    func releaseAll() {
        for state in states.values { state.restore() }
        states.removeAll()
    }
}

/// Threshold state is independent of the feedback preference and the animation clock.
struct SwipeFeedbackState {
    private(set) var isActive = false
    private(set) var hasCrossedThreshold = false
    private var wasAboveThreshold = false

    mutating func activate(progress: CGFloat, threshold: CGFloat) {
        activate(isOpening: progress > threshold)
    }

    mutating func activate(isOpening: Bool) {
        isActive = true
        hasCrossedThreshold = false
        wasAboveThreshold = isOpening
    }

    mutating func update(progress: CGFloat, threshold: CGFloat) -> Bool {
        update(isOpening: progress > threshold)
    }

    mutating func update(isOpening: Bool) -> Bool {
        guard isActive else { return false }
        let above = isOpening
        let firstCrossing = above && !wasAboveThreshold && !hasCrossedThreshold
        wasAboveThreshold = above
        if firstCrossing { hasCrossedThreshold = true }
        return firstCrossing
    }

    mutating func reset() {
        isActive = false
        hasCrossedThreshold = false
        wasAboveThreshold = false
    }
}

extension SwipePhysics {
    static func shouldSyncOpenWidth(
        oldWidth: CGFloat, newWidth: CGFloat, isOpen: Bool, isInteracting: Bool
    ) -> Bool {
        oldWidth != newWidth && newWidth > 0 && isOpen && !isInteracting
    }

    static func shouldRestoreAfterDetach(twoSided: Bool, hasPendingInteraction: Bool) -> Bool {
        twoSided && !hasPendingInteraction
    }

    static func shouldCloseForCloseAll(
        isOpen: Bool, twoSided: Bool, isAnimating: Bool, hasPendingInteraction: Bool
    ) -> Bool {
        // A closing two-sided animator can own a close-then-open continuation even
        // though its logical open state is already false. Legacy filtering stays exact.
        isOpen || (twoSided && (isAnimating || hasPendingInteraction))
    }

    static func validWidth(_ width: CGFloat) -> CGFloat {
        width.isFinite && width > 0 ? width : 0
    }

    static func childRoles(count: Int, twoSided: Bool) -> SwipeChildRoles? {
        if twoSided {
            guard count == 3 else { return nil }
            return SwipeChildRoles(left: 0, right: 1, actions: nil, content: 2)
        }
        guard count > 0 else { return nil }
        // Preserve the raw legacy view's first-two fallback for extra children.
        return SwipeChildRoles(left: nil, right: nil, actions: count > 1 ? 0 : nil, content: count > 1 ? 1 : 0)
    }

    static func latchedSide(
        openSide: SwipeSide?, translation: CGFloat, leftWidth: CGFloat, rightWidth: CGFloat
    ) -> SwipeSide? {
        let candidate: SwipeSide?
        if let openSide = openSide {
            candidate = openSide
        } else {
            candidate = translation > 0 ? .left : (translation < 0 ? .right : nil)
        }
        guard let side = candidate,
              validWidth(side == .left ? leftWidth : rightWidth) > 0 else { return nil }
        return side
    }

    static func constrainToSide(translation: CGFloat, actionsWidth: CGFloat, side: SwipeSide) -> CGFloat {
        guard validWidth(actionsWidth) > 0 else { return 0 }
        return applyRubberBand(
            translation: side == .left ? max(0, translation) : min(0, translation),
            actionsWidth: actionsWidth, isLeading: side == .left
        )
    }

    static func shouldOpenOnSide(
        translation: CGFloat, velocity: CGFloat, friction: CGFloat,
        actionsWidth: CGFloat, threshold: CGFloat, side: SwipeSide, isCurrentlyOpen: Bool
    ) -> Bool {
        // Translation is relative gesture displacement. The legacy snap helper accounts
        // for the starting-open state; adding the row's start offset here counts it twice.
        shouldSnapToOpen(
            projectedTranslation: projectFinalPosition(translation: translation, velocity: velocity, friction: friction),
            actionsWidth: actionsWidth, threshold: threshold,
            isLeading: side == .left, isCurrentlyOpen: isCurrentlyOpen
        )
    }
}
