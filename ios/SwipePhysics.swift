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

/// Gesture-owned completion survives width reconciliation, but not commands or rebinding.
enum SwipeAutoCloseState: Equatable {
    case waiting(side: SwipeSide, deadline: TimeInterval)
    case closing(side: SwipeSide)

    var side: SwipeSide {
        switch self {
        case .waiting(let side, _), .closing(let side): return side
        }
    }

    func remainingDelay(at now: TimeInterval) -> TimeInterval {
        guard case .waiting(_, let deadline) = self else { return 0 }
        return max(0, deadline - now)
    }
}

struct SwipeReconciledState {
    let openSide: SwipeSide?
    let autoClose: SwipeAutoCloseState?
}

/// A released gesture retains its callback ownership until completion or cancellation.
/// Touch activation is deliberately independent: settling and auto-close have no active touch.
struct SwipeGestureCompletion {
    private(set) var isPending = false
    private var owner: [String: String]?

    mutating func begin() { isPending = true; owner = nil }

    mutating func begin(recyclingKey: String?, side: SwipeSide) {
        begin()
        var metadata = ["side": side.rawValue]
        if let key = recyclingKey { metadata["recyclingKey"] = key }
        owner = metadata
    }

    mutating func complete() { isPending = false; owner = nil }

    /// Capture the abandoned owner before native work is reset. No public end is owed.
    mutating func cancel(recyclingKey: String?, side: SwipeSide?) -> [String: String]? {
        let capturedOwner = owner
        guard invalidate() else { return nil }
        if let capturedOwner = capturedOwner { return capturedOwner }
        var metadata: [String: String] = [:]
        if let key = recyclingKey { metadata["recyclingKey"] = key }
        if let side = side { metadata["side"] = side.rawValue }
        return metadata
    }

    @discardableResult
    mutating func invalidate(preserving: Bool = false) -> Bool {
        guard !preserving else { return false }
        let cancelled = isPending
        isPending = false
        owner = nil
        return cancelled
    }
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

/// Capture ownership at physical touch-down, before a pan can leave .possible.
/// Additional fingers cannot transfer an unfinished sequence to a new binding.
struct SwipeTouchBinding<Owner: AnyObject> {
    private var touches: Set<ObjectIdentifier> = []
    private var target: SwipeCommandTarget<Owner>?

    mutating func begin<Touch: AnyObject>(_ newTouches: [Touch], target: SwipeCommandTarget<Owner>?) {
        guard !newTouches.isEmpty else { return }
        if touches.isEmpty { self.target = target }
        touches.formUnion(newTouches.map { ObjectIdentifier($0) })
    }

    mutating func end<Touch: AnyObject>(_ endedTouches: [Touch]) {
        touches.subtract(endedTouches.map { ObjectIdentifier($0) })
        // Retain identity for a queued ended/cancelled action until the next down.
    }

    mutating func prune<Touch: AnyObject>(keeping activeTouches: [Touch]) {
        touches.formIntersection(activeTouches.map { ObjectIdentifier($0) })
    }

    func isCurrent(_ current: SwipeCommandTarget<Owner>) -> Bool {
        target === current && target?.value != nil
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

    // closeAll's equivalent of an unbound close(key). Bound rows close through their own command.
    mutating func clearUnbound<View: AnyObject>(bindings: [String: SwipeCommandTarget<View>]) {
        for key in Array(sides.keys) where bindings[key]?.value == nil {
            set(nil, for: key)
        }
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
    static func reconcileTwoSidedState(
        openSide: SwipeSide?, autoCloseState: SwipeAutoCloseState?,
        leftWidth: CGFloat, rightWidth: CGFloat,
        wasGestureEnabled: Bool, gestureEnabled: Bool, autoClose: Bool
    ) -> SwipeReconciledState {
        // Disabling is a transition. A subsequent imperative open remains valid while disabled.
        guard !wasGestureEnabled || gestureEnabled else {
            return SwipeReconciledState(openSide: nil, autoClose: nil)
        }
        func enabled(_ side: SwipeSide) -> Bool {
            validWidth(side == .left ? leftWidth : rightWidth) > 0
        }
        let restored = openSide.flatMap { enabled($0) ? $0 : nil }
        let pending = autoCloseState.flatMap { state -> SwipeAutoCloseState? in
            guard autoClose, enabled(state.side) else { return nil }
            switch state {
            case .waiting: return restored == state.side ? state : nil
            case .closing: return restored == nil ? state : nil
            }
        }
        return SwipeReconciledState(openSide: restored, autoClose: pending)
    }

    static func shouldRestoreAfterDetach(hasPendingInteraction: Bool) -> Bool {
        !hasPendingInteraction
    }

    static func shouldCloseForCloseAll(
        isOpen: Bool, isAnimating: Bool, hasPendingInteraction: Bool
    ) -> Bool {
        // A closing animator can own a close-then-open continuation while logically closed.
        isOpen || isAnimating || hasPendingInteraction
    }

    static func validWidth(_ width: CGFloat) -> CGFloat {
        width.isFinite && width > 0 ? width : 0
    }

    static func childRoles(count: Int) -> SwipeChildRoles? {
        guard count == 3 else { return nil }
        return SwipeChildRoles(left: 0, right: 1, content: 2)
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
