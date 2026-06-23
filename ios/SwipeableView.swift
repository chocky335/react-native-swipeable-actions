import ExpoModulesCore
import UIKit

#if canImport(React)
import React
#endif

// MARK: - WeakRef Helper

private class WeakRef<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}

public class SwipeableView: ExpoView {

    // MARK: - Cached RN Touch Handler Classes (2.4)
    // Cache NSClassFromString results to avoid repeated lookups and improve type safety
    private static let surfaceTouchHandlerClass: AnyClass? = NSClassFromString("RCTSurfaceTouchHandler")
    private static let touchHandlerClass: AnyClass? = NSClassFromString("RCTTouchHandler")

    /// Check if a gesture recognizer is a React Native touch handler
    /// Uses cached class references with string fallback for compatibility
    private static func isRNTouchHandler(_ recognizer: UIGestureRecognizer) -> Bool {
        // Primary: Check against cached classes
        if let cls = surfaceTouchHandlerClass, recognizer.isKind(of: cls) { return true }
        if let cls = touchHandlerClass, recognizer.isKind(of: cls) { return true }

        // Fallback: String-based check for different RN versions or renamed classes
        let typeName = String(describing: type(of: recognizer))
        return typeName.contains("SurfaceTouchHandler") || typeName.contains("RCTTouchHandler")
    }

    /// Walk from a hit-tested view up to (but not including) self, checking for gesture recognizers.
    /// Any child view with a gesture recognizer (RNGH, custom, etc.) takes priority over our pan.
    private func hasChildGesture(from view: UIView) -> Bool {
        var current: UIView? = view
        while let v = current, v !== self {
            if !(v.gestureRecognizers ?? []).isEmpty {
                return true
            }
            current = v.superview
        }
        return false
    }

    // MARK: - Thread-Safe Static Registry

    private static let registryQueue = DispatchQueue(label: "com.swipeable.registry", qos: .userInteractive)
    private static var _openStateCache: [String: Bool] = [:]
    private static var _viewRegistry: [String: WeakRef<SwipeableView>] = [:]

    static func getOpenState(for key: String) -> Bool {
        registryQueue.sync { _openStateCache[key] ?? false }
    }

    private static func setOpenState(for key: String, isOpen: Bool) {
        registryQueue.async(flags: .barrier) { _openStateCache[key] = isOpen }
    }

    private static func getView(for key: String) -> SwipeableView? {
        registryQueue.sync { _viewRegistry[key]?.value }
    }

    private static func registerView(_ view: SwipeableView, for key: String) {
        registryQueue.async(flags: .barrier) { _viewRegistry[key] = WeakRef(view) }
    }

    private static func unregisterView(_ view: SwipeableView, for key: String) {
        // Identity-check: a newer SwipeableView may have already taken over this
        // key (FlashList remounts a new instance before the old one's deinit
        // fires). Without this guard the old view's deinit blindly removes the
        // key, leaving the new view orphaned in the registry — closeByKey for
        // that key then returns nil and the visible row can't be closed.
        //
        // Capture identity as a *value* (ObjectIdentifier), never reference
        // `view` inside the async closure. Callers include `deinit`, where
        // `self` is mid-deallocation; strongly capturing it in an escaping
        // closure produces a zombie reference and crashes (EXC_BAD_ACCESS) when
        // the barrier finally runs after the object has been freed.
        let identity = ObjectIdentifier(view)
        registryQueue.async(flags: .barrier) {
            if let registered = _viewRegistry[key]?.value,
               ObjectIdentifier(registered) == identity {
                _viewRegistry.removeValue(forKey: key)
            }
        }
    }

    private static func clearOpenState(for key: String) {
        registryQueue.async(flags: .barrier) { _openStateCache.removeValue(forKey: key) }
    }

    private static func getAllViews() -> [SwipeableView] {
        registryQueue.sync { _viewRegistry.values.compactMap { $0.value } }
    }

    // MARK: - Static Methods (by recyclingKey)

    static func openByKey(_ key: String) {
        DispatchQueue.main.async {
            getView(for: key)?.open()
        }
    }

    static func closeByKey(_ key: String, animated: Bool = true) {
        DispatchQueue.main.async {
            if let view = getView(for: key) {
                view.close(animated: animated)
            } else {
                // View was recycled away (or unregistered) before this close
                // could run. Update the cache directly so a future cell binding
                // to this key starts closed instead of inheriting a stale open
                // state — see recyclingKey setter for the matching invariant.
                setOpenState(for: key, isOpen: false)
            }
        }
    }

    static func cancelByKey(_ key: String) {
        DispatchQueue.main.async {
            getView(for: key)?.cancelGesture()
        }
    }

    /// Close all swipeables. When animated=true, only closes open views. When animated=false, resets all views.
    static func closeAll(animated: Bool = true) {
        let views = getAllViews()
        DispatchQueue.main.async {
            if animated {
                // Only close open views when animated
                views.filter { $0.isOpen }.forEach { $0.close(animated: true) }
            } else {
                // Reset all views when not animated
                views.forEach { $0.close(animated: false) }
            }
        }
    }

    // MARK: - State
    private var actionsView: UIView?
    private var contentView: UIView?
    // Track React-managed children explicitly via Fabric's mount hooks.
    // Using UIView.subviews is unsafe because UIKit/Expo/RN may insert helper
    // views (clipping wrappers, focus indicators, etc.) that shift indices and
    // cause us to transform the wrong UIView.
    private var reactChildren: [UIView] = []
    private var currentTranslation: CGFloat = 0
    private var isOpen = false
    private var startOffset: CGFloat = 0
    private var isDragging = false
    private var isAnimating = false
    private var gestureStartTranslation: CGFloat = 0
    private var isGestureActivated = false
    private var pendingShouldOpen = false
    private var lastEmittedWillEndState: String?
    private weak var savedFirstResponder: UIView?

    // MARK: - Props

    var actionsWidth: CGFloat = 0 {
        didSet {
            let validated = max(0, actionsWidth)
            if validated != actionsWidth {
                actionsWidth = validated
                return
            }
            if shouldSyncOpenLayoutForPropChange(oldValue: oldValue, newValue: validated) {
                syncOpenStateToCurrentWidth()
            }
            setNeedsLayout()
        }
    }

    var actionsPosition: String = "right" {
        didSet {
            let validPositions = ["left", "right"]
            if !validPositions.contains(actionsPosition) {
                actionsPosition = "right"
                return
            }
            setNeedsLayout()
        }
    }

    var isLeading: Bool { actionsPosition == "left" }

    var friction: CGFloat = 1.0 {
        didSet { friction = max(0.0, min(1.0, friction)) }
    }

    var threshold: CGFloat = 0.4 {
        didSet { threshold = max(0.0, min(1.0, threshold)) }
    }

    var gestureEnabled: Bool = true {
        didSet {
            guard gestureEnabled != oldValue else { return }

            if !gestureEnabled {
                abortActiveGesture()
                panGesture.isEnabled = false

                // Close if open (instant reset, no animation)
                if isOpen || currentTranslation != 0 {
                    close(animated: false)
                }
            } else {
                panGesture.isEnabled = true
            }
        }
    }

    /// Cancels an in-flight pan gesture and snaps the view back to closed.
    /// Use from `onSwipeStart` to abort a swipe before it can complete.
    func cancelGesture() {
        guard isGestureActivated || isDragging || currentTranslation != 0 else { return }

        abortActiveGesture()

        // Toggle isEnabled to fire .cancelled synchronously on the recognizer,
        // then re-enable so the next gesture can begin.
        panGesture.isEnabled = false
        panGesture.isEnabled = true

        if isOpen || currentTranslation != 0 {
            close(animated: false)
        }
    }

    private func abortActiveGesture() {
        guard isGestureActivated || isDragging else { return }
        isGestureActivated = false
        isDragging = false
        gestureStartTranslation = 0
        stopProgressUpdates()
    }

    var dragOffsetFromEdge: CGFloat = 0 {
        didSet { dragOffsetFromEdge = max(0, dragOffsetFromEdge) }
    }

    var autoClose: Bool = false

    var autoCloseTimeout: CGFloat = 0 {  // milliseconds
        didSet { autoCloseTimeout = max(0, autoCloseTimeout) }
    }

    var recyclingKey: String? {
        didSet {
            guard oldValue != recyclingKey else { return }

            // Thread-safe read of new key's state
            let shouldOpen = recyclingKey.map { Self.getOpenState(for: $0) } ?? false
            pendingShouldOpen = shouldOpen

            // Unregister from the old key. We intentionally do NOT write back
            // `isOpen` here: open() and close() already maintain the cache when
            // the user actually triggers the state change. Writing the view's
            // current `isOpen` at reassignment time captures stale state when a
            // pending async close hasn't run yet, leaving the old key cached as
            // open forever — the next cell binding to it would snap open
            // without any user intent.
            if let old = oldValue {
                Self.unregisterView(self, for: old)
            }

            // Thread-safe register with new key
            if let new = recyclingKey {
                Self.registerView(self, for: new)
            }

            close(animated: false)

            // Apply using local shouldOpen (pendingShouldOpen was cleared by close)
            if shouldOpen {
                DispatchQueue.main.async { [weak self] in self?.snapToOpen() }
            }
        }
    }

    // MARK: - Events

    let onSwipeProgress = EventDispatcher()
    let onSwipeStart = EventDispatcher()
    let onSwipeStateChange = EventDispatcher()
    let onSwipeEnd = EventDispatcher()
    private var displayLink: CADisplayLink?
    private var lastEmittedProgress: CGFloat = -1

    // Auto-close work item for tracking and cancellation
    private var autoCloseWorkItem: DispatchWorkItem?

    // UIViewPropertyAnimator for interruptible animations (2.1, 2.2)
    private var currentAnimator: UIViewPropertyAnimator?

    // MARK: - First Responder Helper

    private func findFirstResponder(in view: UIView?) -> UIView? {
        guard let view = view else { return nil }
        if view.isFirstResponder { return view }
        for subview in view.subviews {
            if let found = findFirstResponder(in: subview) { return found }
        }
        return nil
    }

    private lazy var panGesture: UIPanGestureRecognizer = {
        let gesture = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
        gesture.delegate = self
        gesture.cancelsTouchesInView = false
        gesture.delaysTouchesBegan = true
        gesture.delaysTouchesEnded = false
        return gesture
    }()

    // MARK: - Init

    public required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        setupViews()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        stopProgressUpdates()
        cancelAutoClose()
        // Stop any running animations (2.2)
        currentAnimator?.stopAnimation(true)
        currentAnimator = nil
        removeGestureRecognizer(panGesture)
        // Thread-safe deregister from view registry
        if let key = recyclingKey {
            Self.unregisterView(self, for: key)
        }
    }

    public override func willMove(toSuperview newSuperview: UIView?) {
        if newSuperview == nil {
            // Stop all timers and animations
            stopProgressUpdates()
            cancelAutoClose()
            currentAnimator?.stopAnimation(true)
            currentAnimator = nil
            isAnimating = false

            // Reset internal gesture/translation state so a re-attached view
            // (FlashList recycle) does not re-apply a stale currentTranslation
            // in the next layoutSubviews pass.
            currentTranslation = 0
            isOpen = false
            pendingShouldOpen = false
            startOffset = 0
            lastEmittedProgress = -1
            isDragging = false
            isGestureActivated = false
            gestureStartTranslation = 0

            // Reset layer properties to prevent corruption
            contentView?.transform = .identity
            contentView?.layer.zPosition = 0
            actionsView?.transform = .identity
            actionsView?.layer.zPosition = 0

            // Unregister from static registry and clear cached state
            if let key = recyclingKey {
                Self.unregisterView(self, for: key)
                Self.clearOpenState(for: key)
            }
        }
        super.willMove(toSuperview: newSuperview)
    }

    private func setupViews() {
        clipsToBounds = true
        isUserInteractionEnabled = true
        addGestureRecognizer(panGesture)
    }

    public override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }

        // Re-register in the view registry after reattach (e.g. returning from navigation).
        // willMove(toSuperview: nil) unregisters the view, but the recyclingKey prop setter
        // short-circuits when the value hasn't changed, so the view is never re-registered
        // unless we do it here.
        if let key = recyclingKey {
            Self.registerView(self, for: key)
        }

        // Ensure gesture is attached to this view (handles view hierarchy changes)
        if panGesture.view !== self {
            panGesture.view?.removeGestureRecognizer(panGesture)
            addGestureRecognizer(panGesture)
        }
    }

    public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if isDragging || isGestureActivated {
            // Return self to capture the touch but still allow our pan gesture to work
            return self.bounds.contains(point) ? self : nil
        }
        return super.hitTest(point, with: event)
    }

    public override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        savedFirstResponder = findFirstResponder(in: window)
        super.touchesBegan(touches, with: event)
    }

    /// Cancels Fabric touch handling to prevent gesture conflicts
    /// Uses cached class check via isRNTouchHandler helper (2.4)
    private func cancelFabricTouches() {
        var currentView: UIView? = self
        while let view = currentView {
            for recognizer in view.gestureRecognizers ?? [] {
                if Self.isRNTouchHandler(recognizer) {
                    recognizer.isEnabled = false
                    recognizer.isEnabled = true
                    return
                }
            }
            currentView = view.superview
        }
    }


    private func startProgressUpdates() {
        guard displayLink == nil else { return }
        displayLink = CADisplayLink(target: self, selector: #selector(emitProgressUpdate))

        // Optimize for ProMotion displays (iOS 15+)
        if #available(iOS 15.0, *) {
            displayLink?.preferredFrameRateRange = CAFrameRateRange(
                minimum: 60,
                maximum: 120,
                preferred: 120
            )
        }

        displayLink?.add(to: .main, forMode: .common)
    }

    private func stopProgressUpdates() {
        displayLink?.invalidate()
        displayLink = nil
        lastEmittedProgress = -1
    }

    private func cancelAutoClose() {
        autoCloseWorkItem?.cancel()
        autoCloseWorkItem = nil
    }

    private func scheduleAutoClose() {
        cancelAutoClose()
        let delay = autoCloseTimeout > 0 ? autoCloseTimeout / 1000.0 : 0
        let workItem = DispatchWorkItem { [weak self] in
            self?.tryAutoClose()
        }
        autoCloseWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func tryAutoClose() {
        autoCloseWorkItem = nil

        // If animation is still running, keep retrying until it completes
        if isAnimating {
            let retryWorkItem = DispatchWorkItem { [weak self] in
                self?.tryAutoClose()
            }
            autoCloseWorkItem = retryWorkItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: retryWorkItem)
        } else if isOpen {
            // Emit "open" state when autoClose completes - user's swipe intent was achieved
            close(autoCloseOverride: true)
        }
    }

    @objc private func emitProgressUpdate() {
        guard actionsWidth > 0 else { return }

        // During animation, read from presentation layer to get actual animated value
        var translation = currentTranslation
        if isAnimating, let presentationLayer = contentView?.layer.presentation() {
            translation = presentationLayer.transform.m41 // tx component of transform
            // Update actions to match content position
            let progress = min(abs(translation) / actionsWidth, 1.0)
            let offset = isLeading ? -actionsWidth : actionsWidth
            let actionsTranslateX = offset * (1 - progress)
            actionsView?.transform = CGAffineTransform(translationX: actionsTranslateX, y: 0)
        }

        let progress = abs(translation) / actionsWidth

        if abs(progress - lastEmittedProgress) > SwipeAnimationConfig.progressChangeThreshold {
            lastEmittedProgress = progress
            onSwipeProgress([
                "progress": progress,
                "translationX": translation
            ])
        }
    }

    private func updateActionsTransform() {
        guard let actionsView = actionsView, actionsWidth > 0 else { return }
        let progress = min(abs(currentTranslation) / actionsWidth, 1.0)
        let offset = isLeading ? -actionsWidth : actionsWidth
        let actionsTranslateX = offset * (1 - progress)
        actionsView.transform = CGAffineTransform(translationX: actionsTranslateX, y: 0)
    }

    private func shouldSyncOpenLayoutForPropChange(oldValue: CGFloat, newValue: CGFloat) -> Bool {
        guard oldValue != newValue else { return false }
        guard isOpen, !isDragging, !isAnimating, !isGestureActivated else { return false }
        return newValue > 0
    }

    private func syncOpenStateToCurrentWidth() {
        let targetX = isLeading ? actionsWidth : -actionsWidth
        currentTranslation = targetX
        contentView?.transform = CGAffineTransform(translationX: targetX, y: 0)

        if actionsView != nil {
            actionsView?.transform = .identity
        } else {
            onSwipeStart([:])
        }

        onSwipeProgress(["progress": 1.0, "translationX": targetX])
    }

    // MARK: - View Lifecycle

    // Track React-managed children only. Fabric guarantees this fires solely
    // for views Fabric mounts (the JSX children) — never for UIKit helper
    // views that UIView.subviews would otherwise include.
    public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
        super.mountChildComponentView(childComponentView, index: index)
        // Incoming child may carry a stale transform/zPosition from Fabric recycling;
        // reset it (refreshChildAssignments re-applies the open transform when open).
        childComponentView.transform = .identity
        childComponentView.layer.zPosition = 0
        let clampedIndex = min(max(index, 0), reactChildren.count)
        reactChildren.insert(childComponentView, at: clampedIndex)
        refreshChildAssignments()
    }

    public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
        // Content recycled mid-animation: stop the animator before contentView is
        // nil'd below, else it keeps writing a transform onto the pooled view.
        // (Android skips this — RN zeroes translationX on recycle; port if needed.)
        if childComponentView === contentView {
            currentAnimator?.stopAnimation(true)
            currentAnimator = nil
            isAnimating = false
            stopProgressUpdates()
            cancelAutoClose()  // a pending timer would fire on the reused view
        }

        // Fabric recycles UIView instances. Before handing this child back, undo any
        // transform / zPosition we may have applied — otherwise the next React
        // component that receives this recycled UIView inherits our stale state and
        // appears translated.
        childComponentView.transform = .identity
        childComponentView.layer.zPosition = 0

        if index >= 0 && index < reactChildren.count && reactChildren[index] === childComponentView {
            reactChildren.remove(at: index)
        } else if let found = reactChildren.firstIndex(where: { $0 === childComponentView }) {
            reactChildren.remove(at: found)
        }

        if childComponentView === contentView { contentView = nil }
        if childComponentView === actionsView { actionsView = nil }

        super.unmountChildComponentView(childComponentView, index: index)
        refreshChildAssignments()
    }

    private func refreshChildAssignments() {
        let wasActionsNil = actionsView == nil
        let wasContentNil = contentView == nil

        switch reactChildren.count {
        case 0:
            contentView = nil
            actionsView = nil
        case 1:
            contentView = reactChildren[0]
            contentView?.layer.zPosition = 1
            actionsView = nil
        case 2:
            actionsView = reactChildren[0]
            actionsView?.layer.zPosition = -1
            contentView = reactChildren[1]
            contentView?.layer.zPosition = 1
        default:
            #if DEBUG
            print("[SwipeableView] Warning: Expected 1-2 React children, got \(reactChildren.count)")
            #endif
            actionsView = reactChildren[0]
            actionsView?.layer.zPosition = -1
            contentView = reactChildren[1]
            contentView?.layer.zPosition = 1
        }

        setNeedsLayout()

        if wasContentNil && contentView != nil && (isOpen || currentTranslation != 0) {
            contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        }

        if wasActionsNil && actionsView != nil {
            if isOpen || isAnimating {
                actionsView?.transform = .identity
            } else if pendingShouldOpen {
                pendingShouldOpen = false
                DispatchQueue.main.async { [weak self] in
                    self?.snapToOpen()
                }
            }
        }
    }

    public override func layoutSubviews() {
        guard !isDragging && !isAnimating else { return }
        super.layoutSubviews()

        if let actionsView = actionsView {
            var frame = actionsView.frame
            frame.size.height = bounds.height
            actionsView.frame = frame

            if currentTranslation == 0 && actionsWidth > 0 {
                let offset = isLeading ? -actionsWidth : actionsWidth
                actionsView.transform = CGAffineTransform(translationX: offset, y: 0)
            }
        }

        if currentTranslation != 0 {
            contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
            updateActionsTransform()
        }
    }

    // MARK: - Gesture Handling

    func handleGestureStart() {
        guard gestureEnabled, actionsWidth > 0 else { return }

        isDragging = true
        startOffset = currentTranslation
        gestureStartTranslation = 0
        isGestureActivated = true
        onSwipeStart([:])
        startProgressUpdates()
    }

    func handleGestureUpdate(translationX: CGFloat, velocityX: CGFloat) {
        guard actionsWidth > 0 && isGestureActivated else { return }

        let rawTranslation = startOffset + (translationX * friction)
        let constrainedTranslation = SwipePhysics.applyRubberBand(
            translation: rawTranslation,
            actionsWidth: actionsWidth,
            isLeading: isLeading
        )

        currentTranslation = constrainedTranslation
        contentView?.transform = CGAffineTransform(translationX: constrainedTranslation, y: 0)
        updateActionsTransform()
    }

    func handleGestureEnd(translationX: CGFloat, velocityX: CGFloat) {
        guard isGestureActivated else { return }

        isGestureActivated = false
        gestureStartTranslation = 0
        isDragging = false
        stopProgressUpdates()

        let projectedX = SwipePhysics.projectFinalPosition(
            translation: translationX,
            velocity: velocityX,
            friction: friction
        )
        let willOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: projectedX,
            actionsWidth: actionsWidth,
            threshold: threshold,
            isLeading: isLeading,
            isCurrentlyOpen: isOpen
        )

        if willOpen {
            open(velocity: velocityX)
        } else {
            close(velocity: velocityX)
        }
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard actionsWidth > 0 else { return }

        switch gesture.state {
        case .began:
            handlePanBegan(gesture)
        case .changed:
            handlePanChanged(gesture)
        case .ended, .cancelled:
            handlePanEnded(gesture)
        default:
            break
        }
    }

    private func handlePanBegan(_ gesture: UIPanGestureRecognizer) {
        // Cancel RN touches immediately when pan begins to prevent press events during swipe
        cancelFabricTouches()

        // Capture animation position if interrupted using UIViewPropertyAnimator (2.2)
        if isAnimating, let animator = currentAnimator {
            // Pause to capture current position, then stop completely
            animator.pauseAnimation()
            if let presentationLayer = contentView?.layer.presentation() {
                currentTranslation = presentationLayer.transform.m41
                contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
            }
            if let actionsPresentation = actionsView?.layer.presentation() {
                actionsView?.transform = CGAffineTransform(translationX: actionsPresentation.transform.m41, y: 0)
            }
            animator.stopAnimation(true)
            currentAnimator = nil
            isAnimating = false
        }

        let translation = gesture.translation(in: self).x
        gestureStartTranslation = translation
        isGestureActivated = (dragOffsetFromEdge <= 0)

        if isGestureActivated {
            activateGesture()
        }
    }

    private func handlePanChanged(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: self).x

        if !isGestureActivated {
            let dragDistance = abs(translation - gestureStartTranslation)
            guard dragDistance >= dragOffsetFromEdge else { return }

            isGestureActivated = true
            gestureStartTranslation = translation
            activateGesture()
        }

        let effectiveTranslation = translation - gestureStartTranslation
        let rawTranslation = startOffset + (effectiveTranslation * friction)
        let clampedTranslation = isLeading ? max(0, rawTranslation) : min(0, rawTranslation)
        let constrainedTranslation = SwipePhysics.applyRubberBand(
            translation: clampedTranslation,
            actionsWidth: actionsWidth,
            isLeading: isLeading
        )

        currentTranslation = constrainedTranslation
        contentView?.transform = CGAffineTransform(translationX: constrainedTranslation, y: 0)
        updateActionsTransform()

        // Emit onSwipeStateChange when threshold crossing changes intended state
        let wouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: constrainedTranslation,
            actionsWidth: actionsWidth,
            threshold: threshold,
            isLeading: isLeading,
            isCurrentlyOpen: isOpen
        )
        let intendedState = wouldOpen ? "open" : "closed"
        if lastEmittedWillEndState != intendedState {
            lastEmittedWillEndState = intendedState
            onSwipeStateChange(["state": intendedState])
        }
    }

    private func handlePanEnded(_ gesture: UIPanGestureRecognizer) {
        guard isGestureActivated else {
            gestureStartTranslation = 0
            savedFirstResponder = nil  // Clear saved responder if gesture wasn't activated
            return
        }

        let translation = gesture.translation(in: self).x
        let velocity = gesture.velocity(in: self).x
        let effectiveTranslation = translation - gestureStartTranslation

        isGestureActivated = false
        gestureStartTranslation = 0
        isDragging = false
        stopProgressUpdates()

        let projectedX = SwipePhysics.projectFinalPosition(
            translation: effectiveTranslation,
            velocity: velocity,
            friction: friction
        )
        let willOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: projectedX,
            actionsWidth: actionsWidth,
            threshold: threshold,
            isLeading: isLeading,
            isCurrentlyOpen: isOpen
        )

        // Only emit onSwipeStateChange if state changed from what was emitted during drag
        // (velocity projection may result in different final state)
        let intendedState = willOpen ? "open" : "closed"
        if lastEmittedWillEndState != intendedState {
            lastEmittedWillEndState = intendedState
            onSwipeStateChange(["state": intendedState])
        }

        if willOpen {
            open(velocity: velocity)
            // Schedule auto-close if enabled
            if autoClose {
                scheduleAutoClose()
            }
        } else {
            close(velocity: velocity)
        }
    }

    private func activateGesture() {
        isDragging = true
        startOffset = currentTranslation
        lastEmittedWillEndState = isOpen ? "open" : "closed"
        onSwipeStart([:])
        startProgressUpdates()
    }

    // MARK: - Open/Close

    func open(velocity: CGFloat = 0) {
        // Cancel any existing animation
        currentAnimator?.stopAnimation(true)
        currentAnimator = nil

        isOpen = true
        isAnimating = true
        if let key = recyclingKey { Self.setOpenState(for: key, isOpen: true) }
        let targetX = isLeading ? actionsWidth : -actionsWidth

        // Start displayLink to sync actions with content during animation
        startProgressUpdates()

        // Create interruptible spring animator (2.1)
        let animator = UIViewPropertyAnimator(
            duration: SwipeAnimationConfig.openDuration,
            dampingRatio: SwipeAnimationConfig.openDamping
        ) {
            // Only animate content - actions are synced via displayLink
            self.contentView?.transform = CGAffineTransform(translationX: targetX, y: 0)
        }

        animator.addCompletion { [weak self] position in
            guard let self = self, position == .end else { return }

            self.currentTranslation = targetX
            self.isAnimating = false
            self.currentAnimator = nil
            self.stopProgressUpdates()
            // Ensure final actions position
            self.actionsView?.transform = .identity
            self.onSwipeProgress(["progress": 1.0, "translationX": targetX])
            // With autoClose, let close() emit onSwipeEnd("open") instead
            if !self.autoClose {
                self.onSwipeEnd(["state": "open"])
            }

            // Restore first responder if it was lost during swipe (keyboard preservation)
            if let saved = self.savedFirstResponder, !saved.isFirstResponder {
                saved.becomeFirstResponder()
            }
            self.savedFirstResponder = nil
        }

        // Store reference for interruption handling (2.2)
        currentAnimator = animator
        animator.startAnimation()
    }

    func snapToOpen() {
        isOpen = true
        isAnimating = false
        let targetX = isLeading ? actionsWidth : -actionsWidth
        currentTranslation = targetX

        // Set content translation immediately
        contentView?.transform = CGAffineTransform(translationX: targetX, y: 0)

        if actionsView != nil {
            // Actions already mounted - position them
            actionsView?.transform = .identity
        } else {
            // Actions not mounted yet (React lazy rendering)
            // Trigger onSwipeStart so React renders SwipeableActions
            // didAddSubview will handle positioning when actions are added
            onSwipeStart([:])
        }

        onSwipeProgress(["progress": 1.0, "translationX": targetX])
    }

    // autoCloseOverride is a value, not a sticky flag: an interrupted close (which
    // never runs the completion) can't strand it and mislabel a later close as "open".
    func close(animated: Bool = true, velocity: CGFloat = 0, autoCloseOverride: Bool = false) {
        cancelAutoClose()
        stopProgressUpdates()

        // Cancel any existing animation (2.2)
        currentAnimator?.stopAnimation(true)
        currentAnimator = nil

        // Clear gesture state (unified from reset)
        isDragging = false
        isGestureActivated = false
        gestureStartTranslation = 0
        pendingShouldOpen = false

        isOpen = false
        // Only persist to cache when animated (user action), not when resetting (recycling)
        if animated {
            if let key = recyclingKey { Self.setOpenState(for: key, isOpen: false) }
        }

        let actionsOffset = isLeading ? -actionsWidth : actionsWidth

        if animated {
            // Animated close with spring physics using UIViewPropertyAnimator (2.1)
            isAnimating = true
            startProgressUpdates()

            let animator = UIViewPropertyAnimator(
                duration: SwipeAnimationConfig.closeDuration,
                dampingRatio: SwipeAnimationConfig.closeDamping
            ) {
                self.contentView?.transform = .identity
            }

            animator.addCompletion { [weak self] position in
                guard let self = self, position == .end else { return }

                self.currentTranslation = 0
                self.isAnimating = false
                self.currentAnimator = nil
                self.stopProgressUpdates()
                self.actionsView?.transform = CGAffineTransform(translationX: actionsOffset, y: 0)
                self.onSwipeProgress(["progress": 0.0, "translationX": 0.0])
                // Emit "open" when autoClose completes - user's swipe intent was achieved
                let endState = autoCloseOverride ? "open" : "closed"
                self.onSwipeEnd(["state": endState])

                // Restore first responder if it was lost during swipe (keyboard preservation)
                if let saved = self.savedFirstResponder, !saved.isFirstResponder {
                    saved.becomeFirstResponder()
                }
                self.savedFirstResponder = nil
            }

            // Store reference for interruption handling (2.2)
            currentAnimator = animator
            animator.startAnimation()
        } else {
            // Instant close (formerly reset)
            isAnimating = false
            currentTranslation = 0
            startOffset = 0
            lastEmittedProgress = -1
            savedFirstResponder = nil

            contentView?.transform = .identity
            actionsView?.transform = CGAffineTransform(translationX: actionsOffset, y: 0)
        }
    }
}

// MARK: - UIGestureRecognizerDelegate

extension SwipeableView: UIGestureRecognizerDelegate {

    public override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        let velocity = pan.velocity(in: self)
        let isHorizontal = abs(velocity.x) > abs(velocity.y)
        guard isHorizontal else { return false }
        let shouldBegin = isOpen || (isLeading ? velocity.x > 0 : velocity.x < 0)

        if shouldBegin {
            // Prevent our pan from starting when the touch is on a child view that has
            // its own gesture recognizers (e.g. RNGH). Delegate-based conflict resolution
            // doesn't work with RNGH (it overrides delegates), so we yield via hit-test.
            let touchPoint = pan.location(in: self)
            if let hitView = super.hitTest(touchPoint, with: nil), hasChildGesture(from: hitView) {
                return false
            }
            cancelFabricTouches()
        }

        return shouldBegin
    }

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        if Self.isRNTouchHandler(otherGestureRecognizer) {
            return false
        }
        return true
    }

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        if otherGestureRecognizer.view is UIScrollView {
            return true
        }

        if Self.isRNTouchHandler(otherGestureRecognizer) {
            return true
        }

        return false
    }
}
