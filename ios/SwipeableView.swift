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

    // MARK: - Thread-Safe Static Registry

    private static let registryQueue = DispatchQueue(label: "com.swipeable.registry", qos: .userInteractive)
    private static var _openStateCache: [String: Bool] = [:]
    private static var _viewRegistry: [String: WeakRef<SwipeableView>] = [:]

    private static func getOpenState(for key: String) -> Bool {
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

    private static func unregisterView(for key: String) {
        registryQueue.async(flags: .barrier) { _viewRegistry.removeValue(forKey: key) }
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
            getView(for: key)?.close(animated: animated)
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

            // Thread-safe write of old key's state and unregister
            if let old = oldValue {
                Self.setOpenState(for: old, isOpen: isOpen)
                Self.unregisterView(for: old)
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

    // Override onSwipeEnd state when autoClose triggers close() (emit "open" instead of "closed")
    private var autoCloseEndEventOverride = false

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
            Self.unregisterView(for: key)
        }
    }

    public override func willMove(toSuperview newSuperview: UIView?) {
        if newSuperview == nil {
            stopProgressUpdates()
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
            autoCloseEndEventOverride = true
            close()
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

    // MARK: - View Lifecycle

    public override func didAddSubview(_ subview: UIView) {
        super.didAddSubview(subview)

        let reactSubviews = subviews
        let wasActionsNil = actionsView == nil
        let wasContentNil = contentView == nil

        // Validate subview count before assignment
        switch reactSubviews.count {
        case 0:
            // Should not happen - we just added a subview
            contentView = nil
            actionsView = nil
        case 1:
            contentView = reactSubviews[0]
            contentView?.layer.zPosition = 1
            actionsView = nil
        case 2:
            actionsView = reactSubviews[0]
            actionsView?.layer.zPosition = -1
            contentView = reactSubviews[1]
            contentView?.layer.zPosition = 1
        default:
            // More than 2 children - log warning but use first two
            #if DEBUG
            print("[SwipeableView] Warning: Expected 1-2 subviews, got \(reactSubviews.count)")
            #endif
            actionsView = reactSubviews[0]
            actionsView?.layer.zPosition = -1
            contentView = reactSubviews[1]
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
        guard actionsWidth > 0 else { return }

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

    func close(animated: Bool = true, velocity: CGFloat = 0) {
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
                let endState = self.autoCloseEndEventOverride ? "open" : "closed"
                self.autoCloseEndEventOverride = false
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

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        false
    }
}
