import ExpoModulesCore
import UIKit

#if canImport(React)
import React
#endif

extension UIView: SwipeChildVisibility {}

private final class SwipeablePanGestureRecognizer: UIPanGestureRecognizer {
    private struct WeakTouch {
        weak var value: UITouch?
    }

    var captureBinding: (() -> SwipeCommandTarget<SwipeableView>?)?
    private var binding = SwipeTouchBinding<SwipeableView>()
    private var trackedTouches: [ObjectIdentifier: WeakTouch] = [:]

    func isCurrentBinding(_ current: SwipeCommandTarget<SwipeableView>) -> Bool {
        binding.isCurrent(current)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        // A failed recognizer may stop receiving touch-end callbacks. Prune only
        // physically finished contacts; resetting recognition is not a fresh down.
        let active = trackedTouches.values.compactMap { $0.value }
            .filter { $0.phase != .ended && $0.phase != .cancelled }
        binding.prune(keeping: active)
        trackedTouches = Dictionary(uniqueKeysWithValues: active.map {
            (ObjectIdentifier($0), WeakTouch(value: $0))
        })
        binding.begin(Array(touches), target: captureBinding?())
        for touch in touches { trackedTouches[ObjectIdentifier(touch)] = WeakTouch(value: touch) }
        super.touchesBegan(touches, with: event)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        binding.end(Array(touches))
        for touch in touches { trackedTouches.removeValue(forKey: ObjectIdentifier(touch)) }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        binding.end(Array(touches))
        for touch in touches { trackedTouches.removeValue(forKey: ObjectIdentifier(touch)) }
    }
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

    /// Child recognizers (RNGH or otherwise) take priority over the row pan.
    private func hasChildGesture(from view: UIView) -> Bool {
        var current: UIView? = view
        while let child = current, child !== self {
            if !(child.gestureRecognizers ?? []).isEmpty { return true }
            current = child.superview
        }
        return false
    }

    // MARK: - Thread-Safe Static Registry

    private static let registryQueue = DispatchQueue(label: "com.swipeable.registry", qos: .userInteractive)
    private static let maxCacheSize = 1000
    private static var _openStateCache = SwipeOpenStateCache(capacity: maxCacheSize)
    private static var _viewRegistry: [String: SwipeCommandTarget<SwipeableView>] = [:]

    static func getOpenState(for key: String) -> Bool {
        registryQueue.sync { _openStateCache.side(for: key) != nil }
    }

    static func getOpenSide(for key: String) -> String? {
        registryQueue.sync { _openStateCache.side(for: key)?.rawValue }
    }

    private static func currentIntent() -> Int {
        registryQueue.sync { _openStateCache.currentIntent }
    }

    private static func isCurrentIntent(_ intent: Int, for mark: SwipeCloseMark) -> Bool {
        registryQueue.sync { _openStateCache.isCurrent(intent, for: mark) }
    }

    private static func bindRestore(_ mark: SwipeCloseMark, to key: String?) -> (side: SwipeSide?, intent: Int)? {
        registryQueue.sync { _openStateCache.bind(mark, to: key) }
    }

    private static func readRestore(for key: String) -> (side: SwipeSide?, intent: Int) {
        registryQueue.sync { _openStateCache.restore(for: key) }
    }

    private static func setOpenState(for key: String, side: SwipeSide?, owner: SwipeableView, intent: Int) {
        let identity = ObjectIdentifier(owner)
        let mark = owner.closeMark
        registryQueue.async {
            // A recycled/detached view must not overwrite its replacement's state.
            if let current = _viewRegistry[key]?.value, ObjectIdentifier(current) != identity { return }
            // One step with the close commands: an open that a later close made
            // stale persists closed, whether this binding ends first or last.
            _openStateCache.persist(side, for: key, from: mark, intent: intent)
        }
    }

    private static func registerView(_ view: SwipeableView, for key: String) {
        // Registration creates a fresh binding identity, even for A -> B -> A on
        // the same view or a detach/reattach. Open/close never change this identity.
        let reference = SwipeCommandTarget(view)
        registryQueue.async(flags: .barrier) { _viewRegistry[key] = reference }
    }

    private static func unregisterView(_ view: SwipeableView, for key: String) {
        // Do not retain a deinitializing view in asynchronous registry work.
        let identity = ObjectIdentifier(view)
        registryQueue.async {
            guard _viewRegistry[key]?.identity == identity else { return }
            _viewRegistry.removeValue(forKey: key)
        }
    }

    /// The command gets the intent read with its target, so a later close marks that target.
    private static func enqueueCommand(for key: String, _ command: @escaping (SwipeableView, Int) -> Void) {
        let (target, intent) = registryQueue.sync { (_viewRegistry[key], _openStateCache.currentIntent) }
        guard let target = target else { return }
        DispatchQueue.main.async {
            performCommand({ command($0, intent) }, for: key, target: target)
        }
    }

    private static func performCommand(
        _ command: (SwipeableView) -> Void, for key: String, target: SwipeCommandTarget<SwipeableView>
    ) {
        let current = registryQueue.sync { _viewRegistry[key] }
        target.perform(ifCurrent: current) { view in
            guard view.recyclingKey == key, !view.isDetached else { return }
            command(view)
        }
    }

    // Raw view refs also need a binding guard, including refs without a key.
    // Opening/closing must not invalidate other commands queued for this binding.
    private lazy var commandTarget = SwipeCommandTarget(self)

    func enqueueCommand(_ command: @escaping (SwipeableView) -> Void) {
        let target = commandTarget
        let key = recyclingKey
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.isDetached, self.recyclingKey == key else { return }
            target.perform(ifCurrent: self.commandTarget) { view in
                if let key = key {
                    let current = Self.registryQueue.sync { Self._viewRegistry[key] }
                    guard current?.value === view else { return }
                }
                command(view)
            }
        }
    }

    // MARK: - Static Methods (by recyclingKey)

    // A keyed open keeps the intent of its command time, not of the main-queue turn.
    static func openByKey(_ key: String) {
        enqueueCommand(for: key) { view, intent in view.open(intent: intent) }
    }

    static func openByKeyOnSide(_ key: String, side: String) {
        guard let side = SwipeSide(rawValue: side) else { return }
        enqueueCommand(for: key) { view, intent in view.open(side: side, intent: intent) }
    }

    static func closeByKey(_ key: String, animated: Bool = true) {
        let (target, sequence) = registryQueue.sync { () -> (SwipeCommandTarget<SwipeableView>?, Int) in
            // Consume the cached intent before any binding can read the cached side.
            let target = _openStateCache.captureCloseTarget(for: key, current: _viewRegistry[key])
            return (target, _openStateCache.currentIntent)
        }
        guard let target = target else { return }
        DispatchQueue.main.async {
            performCommand({ view in
                guard SwipeOpenStateCache.closeApplies(sequence, toOpenIntent: view.openIntent) else { return }
                view.close(animated: animated)
            }, for: key, target: target)
        }
    }

    static func cancelByKey(_ key: String) {
        enqueueCommand(for: key) { view, _ in view.cancelGesture() }
    }

    /// Close all swipeables. When animated=true, only closes open views. When animated=false, resets all views.
    static func closeAll(animated: Bool = true) {
        let (targets, sequence) = registryQueue.sync {
            () -> ([(key: String, target: SwipeCommandTarget<SwipeableView>)], Int) in
            _openStateCache.closeAll()
            return (_viewRegistry.map { (key: $0.key, target: $0.value) }, _openStateCache.currentIntent)
        }
        DispatchQueue.main.async {
            for entry in targets {
                performCommand({ view in
                    guard SwipeOpenStateCache.closeApplies(sequence, toOpenIntent: view.openIntent) else { return }
                    if !animated || SwipePhysics.shouldCloseForCloseAll(
                        isOpen: view.isOpen, isAnimating: view.isAnimating,
                        hasPendingInteraction: view.isDragging || view.isGestureActivated ||
                            view.directGesturePending || view.pendingRestoreSide != nil
                    ) {
                        view.close(animated: animated)
                    }
                }, for: entry.key, target: entry.target)
            }
        }
    }

    // MARK: - State

    private var leftActionsView: UIView?
    private var rightActionsView: UIView?
    private var contentView: UIView?
    private let railVisibility = SwipeRailVisibility()
    // Fabric mount order, not UIView.subviews (which can contain UIKit/Expo helpers).
    private var reactChildren = SwipeReactChildren<UIView>()
    private var isDetached = false
    private var currentTranslation: CGFloat = 0
    private var openSide: SwipeSide?
    private var gestureSide: SwipeSide?
    private var animationSide: SwipeSide?
    private var isOpen: Bool { openSide != nil }
    private var startOffset: CGFloat = 0
    private var gestureStartedOpen = false
    private var isDragging = false
    private var isAnimating = false
    private var gestureStartTranslation: CGFloat = 0
    private var isGestureActivated = false
    private var gestureCompletion = SwipeGestureCompletion()
    private var directGesturePending = false
    private var ignoresPanUntilNextBegin = false
    private var lastEmittedWillEndState: String?
    private weak var savedFirstResponder: UIView?

    // Every asynchronous operation belongs to one key/configuration/command generation.
    private var workGeneration = 0
    private var pendingRestoreSide: SwipeSide?
    private var pendingRestoreIntent = 0
    // The close sequence this view's open intent saw. A later keyed close makes it stale.
    private var openIntent = 0
    // The keyed close mark of the key this view holds. Only the registry queue uses it.
    private let closeMark = SwipeCloseMark()
    private var isCurrentRestore: Bool {
        recyclingKey.map { _ in Self.isCurrentIntent(pendingRestoreIntent, for: closeMark) } ?? true
    }
    private var reconciliationWorkItem: DispatchWorkItem?
    private var visualRestoreWorkItem: DispatchWorkItem?
    private var requestedSides: Set<SwipeSide> = []
    private var slotChildren: [SwipeSide: [ObjectIdentifier]] = [:]

    private struct LayoutConfiguration: Equatable {
        var leftWidth: CGFloat
        var rightWidth: CGFloat
        var enabled: Bool
        var friction: CGFloat
        var threshold: CGFloat
        var dragOffset: CGFloat
        var autoClose: Bool
        var autoCloseTimeout: CGFloat
    }
    private var appliedConfiguration = LayoutConfiguration(
        leftWidth: 0, rightWidth: 0, enabled: true,
        friction: 1, threshold: 0.4, dragOffset: 0, autoClose: false, autoCloseTimeout: 0
    )

    // MARK: - Props

    var leftActionsWidth: CGFloat = 0 {
        didSet {
            leftActionsWidth = SwipePhysics.validWidth(leftActionsWidth)
            if leftActionsWidth != oldValue { scheduleReconciliation() }
        }
    }

    var rightActionsWidth: CGFloat = 0 {
        didSet {
            rightActionsWidth = SwipePhysics.validWidth(rightActionsWidth)
            if rightActionsWidth != oldValue { scheduleReconciliation() }
        }
    }

    var friction: CGFloat = 1.0 {
        didSet {
            friction = max(0.0, min(1.0, friction))
            if friction != oldValue { scheduleReconciliation() }
        }
    }
    var threshold: CGFloat = 0.4 {
        didSet {
            threshold = max(0.0, min(1.0, threshold))
            if threshold != oldValue { scheduleReconciliation() }
        }
    }
    var gestureEnabled = true {
        didSet {
            guard gestureEnabled != oldValue else { return }
            scheduleReconciliation()
        }
    }
    /// Explicit cancellation consumes the rest of the pan and any pending reopen,
    /// but leaves the binding identity intact for later commands in the same JS turn.
    func cancelGesture() {
        ignoresPanUntilNextBegin = true
        abortActiveGesture()
        panGesture.isEnabled = false
        panGesture.isEnabled = gestureEnabled
        performClose(animated: false)
    }

    private func abortActiveGesture() {
        isGestureActivated = false
        directGesturePending = false
        isDragging = false
        gestureStartTranslation = 0
        stopProgressUpdates()
    }

    var dragOffsetFromEdge: CGFloat = 0 {
        didSet {
            dragOffsetFromEdge = max(0, dragOffsetFromEdge)
            if dragOffsetFromEdge != oldValue { scheduleReconciliation() }
        }
    }
    var autoClose = false {
        didSet {
            if autoClose != oldValue {
                cancelAutoClose()
                scheduleReconciliation()
            }
        }
    }
    var autoCloseTimeout: CGFloat = 0 {
        didSet {
            autoCloseTimeout = max(0, autoCloseTimeout)
            if autoCloseTimeout != oldValue { scheduleReconciliation() }
        }
    }

    var appearance = "default" {
        didSet {
            if appearance != oldValue {
                resetFeedback()
                updateActionsTransform()
            }
        }
    }
    var hapticFeedback: Bool? {
        didSet {
            if hapticFeedback != oldValue {
                resetFeedback()
                updateActionsTransform()
            }
        }
    }

    var recyclingKey: String? {
        didSet {
            guard oldValue != recyclingKey else { return }
            let cancelled = gestureCompletion.cancel(recyclingKey: oldValue, side: currentSide)
            commandTarget = SwipeCommandTarget(self)
            // The view stops holding the old key: its mark moves with the cache read.
            let restored = Self.bindRestore(closeMark, to: recyclingKey)
            if let old = oldValue {
                // An abandoned auto-close wait cannot resume, so its transient open must not restore.
                if autoCloseWorkItem != nil { Self.setOpenState(for: old, side: nil, owner: self, intent: openIntent) }
                // Commands own cached intent. Rebinding must not resurrect the old
                // view's stale state while a queued close is waiting to execute.
                Self.unregisterView(self, for: old)
            }
            invalidateWork(preservePresentation: false)
            openSide = nil
            currentTranslation = 0
            savedFirstResponder = nil
            requestedSides.removeAll()
            slotChildren.removeAll()
            contentView?.transform = .identity
            updateActionsTransform()
            pendingRestoreSide = restored?.side
            pendingRestoreIntent = restored?.intent ?? 0
            if let key = recyclingKey, !isDetached { Self.registerView(self, for: key) }
            // Widths may follow the key in the same Expo prop transaction.
            scheduleReconciliation()
            // Registry state is complete before native callback reentry. The
            // cancellation retains the old start's identity across async delivery.
            if let cancelled = cancelled { onGestureCancelled(cancelled) }
        }
    }

    // MARK: - Events and animation

    let onSwipeProgress = EventDispatcher()
    let onSwipeStart = EventDispatcher()
    let onSwipeStateChange = EventDispatcher()
    let onSwipeEnd = EventDispatcher()
    let onActionsNeeded = EventDispatcher()
    let onGestureCancelled = EventDispatcher()
    private var displayLink: CADisplayLink?
    private var lastEmittedProgress: CGFloat = -1
    private var autoCloseWorkItem: DispatchWorkItem?
    private var autoCloseState: SwipeAutoCloseState?
    private var autoCloseGeneration = 0
    private var currentAnimator: UIViewPropertyAnimator?
    private var feedback = SwipeFeedbackState()
    private var feedbackGenerator: UIImpactFeedbackGenerator?
    private var popStartedAt: CFTimeInterval?
    private var reduceMotion = UIAccessibility.isReduceMotionEnabled
    private var usesAppearance: Bool { appearance == "ios26" }
    private var usesHaptics: Bool { hapticFeedback ?? usesAppearance }
    private var currentSide: SwipeSide? {
        gestureSide ?? animationSide ?? openSide
    }
    private var actionsView: UIView? {
        guard let side = currentSide else { return nil }
        return actionsView(for: side)
    }

    private func width(for side: SwipeSide) -> CGFloat {
        return side == .left ? leftActionsWidth : rightActionsWidth
    }

    private func actionsView(for side: SwipeSide) -> UIView? {
        return side == .left ? leftActionsView : rightActionsView
    }

    private func defaultOpenSide() -> SwipeSide? {
        if width(for: .right) > 0 { return .right }
        if width(for: .left) > 0 { return .left }
        return nil
    }

    private func payload(_ values: [String: Any], side: SwipeSide?) -> [String: Any] {
        var result = values
        if let side = side { result["side"] = side.rawValue }
        // Capture identity before EventDispatcher queues delivery to JavaScript.
        if let key = recyclingKey { result["recyclingKey"] = key }
        return result
    }

    private func persistOpenSide() {
        if let key = recyclingKey { Self.setOpenState(for: key, side: openSide, owner: self, intent: openIntent) }
    }

    private func isCurrent(_ generation: Int, key: String?) -> Bool {
        !isDetached && workGeneration == generation && recyclingKey == key
    }

    private func requestActions(on side: SwipeSide) {
        guard width(for: side) > 0 else { return }
        guard requestedSides.insert(side).inserted else { return }
        onActionsNeeded(payload(["side": side.rawValue], side: nil))
    }

    private func scheduleReconciliation() {
        setNeedsLayout()
        guard !isDetached else { return }
        guard reconciliationWorkItem == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            self?.reconciliationWorkItem = nil
            self?.commitProps()
        }
        reconciliationWorkItem = item
        DispatchQueue.main.async(execute: item)
    }

    // Called by Expo after all props, and on the next turn for direct native setters/children.
    func commitProps() {
        reconciliationWorkItem?.cancel()
        reconciliationWorkItem = nil
        guard !isDetached else { return }
        let next = LayoutConfiguration(
            leftWidth: leftActionsWidth, rightWidth: rightActionsWidth,
            enabled: gestureEnabled, friction: friction, threshold: threshold,
            dragOffset: dragOffsetFromEdge, autoClose: autoClose, autoCloseTimeout: autoCloseTimeout
        )
        let previous = appliedConfiguration
        appliedConfiguration = next
        var resumeAutoClose: SwipeAutoCloseState?
        if next != previous {
            if panGesture.state == .began || panGesture.state == .changed {
                ignoresPanUntilNextBegin = true
            }
            let logicalSide = openSide
            let reconciled = SwipePhysics.reconcileTwoSidedState(
                openSide: logicalSide,
                autoCloseState: autoCloseState,
                leftWidth: width(for: .left), rightWidth: width(for: .right),
                wasGestureEnabled: previous.enabled, gestureEnabled: gestureEnabled, autoClose: autoClose
            )
            let presentation = contentView?.layer.presentation()?.transform.m41 ?? currentTranslation
            let preservesCompletion = reconciled.autoClose != nil
            guard invalidateWork(
                preservePresentation: false, clearRestore: false,
                preserveGestureCompletion: preservesCompletion
            ) else { return }
            requestedSides.removeAll()
            openSide = reconciled.openSide
            resumeAutoClose = reconciled.autoClose
            if case .closing = resumeAutoClose {
                currentTranslation = presentation
            } else {
                currentTranslation = openSide.map { $0.sign * width(for: $0) } ?? 0
            }
            contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
            if pendingRestoreSide == nil { persistOpenSide() }
        }
        panGesture.isEnabled = gestureEnabled
        reconcileChildRoles()
        if let cachedSide = pendingRestoreSide {
            let side = cachedSide
            // gestureEnabled turns off only the gesture; cached intent still restores.
            // A keyed close issued after the cache read wins over the read side.
            if width(for: side) <= 0 || !isCurrentRestore {
                pendingRestoreSide = nil
                openSide = nil
                currentTranslation = 0
                persistOpenSide()
            } else if contentView != nil {
                pendingRestoreSide = nil
                snapToOpen(side: side, intent: pendingRestoreIntent)
            } else {
                requestActions(on: side)
            }
        }
        updateActionsTransform()
        setNeedsLayout()
        if let pending = resumeAutoClose {
            switch pending {
            case .waiting:
                resumeAutoCloseTimer(pending)
            case .closing(let side):
                animationSide = side
                performClose(animated: true, endState: "open")
            }
        }
    }

    @discardableResult
    private func invalidateWork(
        preservePresentation: Bool = true,
        clearRestore: Bool = true,
        resetAppearance: Bool = true,
        preserveGestureCompletion: Bool = false
    ) -> Bool {
        let cancelled = preserveGestureCompletion ? nil :
            gestureCompletion.cancel(recyclingKey: recyclingKey, side: currentSide)
        if (panGesture.state == .began || panGesture.state == .changed) {
            ignoresPanUntilNextBegin = true
        }
        workGeneration += 1
        let generation = workGeneration
        cancelAutoClose()
        visualRestoreWorkItem?.cancel()
        visualRestoreWorkItem = nil
        if let animator = currentAnimator {
            if preservePresentation {
                animator.pauseAnimation()
                if let presentation = contentView?.layer.presentation() {
                    currentTranslation = presentation.transform.m41
                }
            }
            animator.stopAnimation(true)
        }
        currentAnimator = nil
        isAnimating = false
        stopProgressUpdates()
        if preservePresentation {
            contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        }
        isGestureActivated = false
        directGesturePending = false
        isDragging = false
        gestureStartTranslation = 0
        gestureSide = nil
        animationSide = nil
        startOffset = 0
        if clearRestore { pendingRestoreSide = nil }
        if resetAppearance { resetFeedback() }
        // Queue the old cancellation before any replacement start. Ownership has
        // already been cleared, so synchronous native reentry cannot cancel twice.
        if let cancelled = cancelled { onGestureCancelled(cancelled) }
        return generation == workGeneration
    }

    // MARK: - Appearance

    private func resetFeedback() {
        feedback.reset()
        feedbackGenerator = nil
        popStartedAt = nil
        for view in [leftActionsView, rightActionsView].compactMap({ $0 }) {
            view.transform = CGAffineTransform(translationX: view.transform.tx, y: view.transform.ty)
        }
    }

    @objc private func reduceMotionChanged() {
        reduceMotion = UIAccessibility.isReduceMotionEnabled
        if reduceMotion { popStartedAt = nil }
        updateActionsTransform()
    }

    private func beginFeedback(on side: SwipeSide) {
        resetFeedback()
        feedback.activate(isOpening: gestureStartedOpen)
        if usesHaptics {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.prepare()
            feedbackGenerator = generator
        }
    }

    private func updateFeedback(on side: SwipeSide, relativeTranslation: CGFloat) {
        let sideWidth = width(for: side)
        guard sideWidth > 0 else { return }
        let isOpening = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: relativeTranslation * friction,
            actionsWidth: sideWidth, threshold: threshold,
            isLeading: side == .left, isCurrentlyOpen: gestureStartedOpen
        )
        guard feedback.update(isOpening: isOpening) else { return }
        if usesHaptics { feedbackGenerator?.impactOccurred() }
        if usesAppearance && !reduceMotion { popStartedAt = CACurrentMediaTime() }
    }

    private func railScale(progress: CGFloat) -> CGFloat {
        guard usesAppearance else { return 1 }
        return SwipeAnimationConfig.actionRailScale(
            progress: progress,
            popElapsed: popStartedAt.map { CACurrentMediaTime() - $0 },
            hasPopped: feedback.hasCrossedThreshold,
            reduceMotion: reduceMotion
        )
    }

    // MARK: - First Responder Helper

    private func findFirstResponder(in view: UIView?) -> UIView? {
        guard let view = view else { return nil }
        if view.isFirstResponder { return view }
        for subview in view.subviews {
            if let found = findFirstResponder(in: subview) { return found }
        }
        return nil
    }

    private lazy var panGesture: SwipeablePanGestureRecognizer = {
        let gesture = SwipeablePanGestureRecognizer(target: self, action: #selector(handlePan))
        gesture.captureBinding = { [weak self] in self?.commandTarget }
        gesture.delegate = self
        gesture.cancelsTouchesInView = false
        gesture.delaysTouchesBegan = true
        gesture.delaysTouchesEnded = false
        return gesture
    }()

    // MARK: - Init and attachment

    public required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        isUserInteractionEnabled = true
        addGestureRecognizer(panGesture)
        NotificationCenter.default.addObserver(
            self, selector: #selector(reduceMotionChanged),
            name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil
        )
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        releaseChildRoles()
        stopProgressUpdates()
        cancelAutoClose()
        reconciliationWorkItem?.cancel()
        visualRestoreWorkItem?.cancel()
        currentAnimator?.stopAnimation(true)
        NotificationCenter.default.removeObserver(self)
        if let key = recyclingKey { Self.unregisterView(self, for: key) }
    }

    private var hasPendingInteraction: Bool {
        isAnimating || isDragging || isGestureActivated || directGesturePending || autoCloseWorkItem != nil
    }

    private func suspendForDetach() {
        guard !isDetached else { return }
        let cancelled = gestureCompletion.cancel(recyclingKey: recyclingKey, side: currentSide)
        let preservesCachedSide = SwipePhysics.shouldRestoreAfterDetach(
            hasPendingInteraction: hasPendingInteraction
        )
        commandTarget = SwipeCommandTarget(self)
        isDetached = true
        reconciliationWorkItem?.cancel()
        reconciliationWorkItem = nil
        invalidateWork(preservePresentation: false)
        savedFirstResponder = nil
        openSide = nil
        currentTranslation = 0
        lastEmittedWillEndState = nil
        requestedSides.removeAll()
        releaseChildRoles()
        if let key = recyclingKey {
            // Restore only settled cache intent, never unfinished interaction work.
            if !preservesCachedSide { Self.setOpenState(for: key, side: nil, owner: self, intent: openIntent) }
            Self.unregisterView(self, for: key)
        }
        if let cancelled = cancelled { onGestureCancelled(cancelled) }
    }

    public override func willMove(toSuperview newSuperview: UIView?) {
        if newSuperview == nil { suspendForDetach() }
        super.willMove(toSuperview: newSuperview)
    }

    public override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            suspendForDetach()
            return
        }
        let wasDetached = isDetached
        isDetached = false
        reduceMotionChanged()
        if let key = recyclingKey {
            Self.registerView(self, for: key)
            if wasDetached {
                // Read again: a closeByKey while detached may have cleared the cache.
                let restored = Self.readRestore(for: key)
                pendingRestoreSide = restored.side
                pendingRestoreIntent = restored.intent
            }
        }
        if panGesture.view !== self {
            panGesture.view?.removeGestureRecognizer(panGesture)
            addGestureRecognizer(panGesture)
        }
        commitProps()
        scheduleVisualRestore()
        // A detached timer/animation must not restart and fabricate an end-open event.
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
        autoCloseGeneration += 1
        autoCloseWorkItem?.cancel()
        autoCloseWorkItem = nil
        autoCloseState = nil
    }

    private func scheduleAutoClose() {
        cancelAutoClose()
        let delay = autoCloseTimeout > 0 ? autoCloseTimeout / 1000.0 : 0
        if let side = openSide {
            autoCloseState = .waiting(side: side, deadline: ProcessInfo.processInfo.systemUptime + delay)
        }
        enqueueAutoClose(
            after: delay, generation: workGeneration, timerGeneration: autoCloseGeneration, key: recyclingKey
        )
    }

    private func resumeAutoCloseTimer(_ state: SwipeAutoCloseState) {
        cancelAutoClose()
        autoCloseState = state
        enqueueAutoClose(
            after: state.remainingDelay(at: ProcessInfo.processInfo.systemUptime),
            generation: workGeneration, timerGeneration: autoCloseGeneration, key: recyclingKey
        )
    }

    private func enqueueAutoClose(after delay: TimeInterval, generation: Int, timerGeneration: Int, key: String?) {
        let item = DispatchWorkItem { [weak self] in
            guard let self = self, self.isCurrent(generation, key: key),
                  self.autoCloseGeneration == timerGeneration,
                  self.autoClose else { return }
            self.autoCloseWorkItem = nil
            if self.isAnimating {
                self.enqueueAutoClose(after: 0.1, generation: generation, timerGeneration: timerGeneration, key: key)
            } else if self.isOpen {
                // Keep the end-open quirk local to this close; cancellation cannot leak it.
                self.performClose(animated: true, endState: "open")
            }
        }
        autoCloseWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    @objc private func emitProgressUpdate() {
        guard let side = currentSide, width(for: side) > 0 else { return }
        let translation = isAnimating
            ? (contentView?.layer.presentation()?.transform.m41 ?? currentTranslation)
            : currentTranslation
        updateActionsTransform(translation: translation)
        let rawProgress = abs(translation) / width(for: side)
        let progress = min(rawProgress, 1)
        if abs(progress - lastEmittedProgress) > SwipeAnimationConfig.progressChangeThreshold {
            lastEmittedProgress = progress
            onSwipeProgress(payload(["progress": progress, "translationX": translation], side: side))
        }
    }

    private func updateActionsTransform(translation: CGFloat? = nil) {
        let translation = translation ?? (isAnimating
            ? (contentView?.layer.presentation()?.transform.m41 ?? currentTranslation)
            : currentTranslation)
        let visibleSide = currentSide
        for side in SwipeSide.allCases {
            guard let rail = actionsView(for: side) else { continue }
            let sideWidth = width(for: side)
            let active = visibleSide == side
            let progress = active && sideWidth > 0 ? min(abs(translation) / sideWidth, 1) : 0
            let offset = -side.sign * sideWidth * (1 - progress)
            let scale = active && (isDragging || isAnimating || isOpen) ? railScale(progress: progress) : 1
            // Explicit tx anchors scaling at the actions' row edge and never scales row translation.
            let tx = SwipeAnimationConfig.actionRailTranslation(
                offset: offset, scale: scale, railWidth: rail.bounds.width, side: side
            )
            rail.transform = CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: tx, ty: 0)
            let revealed = active && sideWidth > 0 && side.sign * translation > 0
            railVisibility.setRevealed(revealed, for: rail)
        }
    }

    // MARK: - React child roles

    private func releaseChild(_ view: UIView) {
        railVisibility.release(view)
        view.transform = .identity
        view.layer.zPosition = 0
    }

    private func releaseChildRoles() {
        for view in [leftActionsView, rightActionsView, contentView].compactMap({ $0 }) {
            releaseChild(view)
        }
        railVisibility.releaseAll()
        leftActionsView = nil
        rightActionsView = nil
        contentView = nil
        slotChildren.removeAll()
    }

    private func reconcileChildRoles() {
        guard !isDetached else { return }
        let children = reactChildren.views
        // On removal, preserve surviving identities instead of promoting a rail to content.
        if let view = contentView, !children.contains(where: { $0 === view }) { releaseChild(view); contentView = nil }
        if let view = leftActionsView, !children.contains(where: { $0 === view }) { releaseChild(view); leftActionsView = nil }
        if let view = rightActionsView, !children.contains(where: { $0 === view }) { releaseChild(view); rightActionsView = nil }
        guard let roles = SwipePhysics.childRoles(count: children.count) else { return }
        let previousLeft = leftActionsView
        let previousRight = rightActionsView
        contentView = children[roles.content]
        // A complete Fabric transaction can give a previously hidden rail the content role.
        // Restore only flags that this view owned, for all side configurations.
        if let contentView = contentView { railVisibility.release(contentView) }
        leftActionsView = roles.left.map { children[$0] }
        rightActionsView = roles.right.map { children[$0] }
        if previousLeft !== leftActionsView { requestedSides.remove(.left) }
        if previousRight !== rightActionsView { requestedSides.remove(.right) }
        contentView?.layer.zPosition = 1
        for side in SwipeSide.allCases {
            guard let rail = actionsView(for: side) else { continue }
            rail.layer.zPosition = -1
            let children = rail.subviews.map { ObjectIdentifier($0) }
            if let previous = slotChildren[side], !previous.isEmpty && previous != children {
                requestedSides.remove(side)
            }
            slotChildren[side] = children
        }
        if let side = currentSide, isOpen || isDragging || isAnimating {
            requestActions(on: side)
        }
        if !isAnimating {
            contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        }
    }

    public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
        super.mountChildComponentView(childComponentView, index: index)
        releaseChild(childComponentView)
        reactChildren.mount(childComponentView, at: index)
        // Fabric mounts slots individually; commit only a complete child protocol.
        reconcileChildRoles()
        scheduleReconciliation()
    }

    public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
        let cancelled = childComponentView === contentView
            ? gestureCompletion.cancel(recyclingKey: recyclingKey, side: currentSide) : nil
        if childComponentView === contentView {
            let interrupted = hasPendingInteraction
            // Invalidate completion/timer generations before returning the child to
            // Fabric's pool, not merely the animator's reference to that child.
            invalidateWork(preservePresentation: false, clearRestore: false)
            savedFirstResponder = nil
            if interrupted {
                openSide = nil
                pendingRestoreSide = nil
                persistOpenSide()
            }
            currentTranslation = openSide.map { $0.sign * width(for: $0) } ?? 0
        }
        // Return both transforms and weakly-owned visibility/accessibility flags.
        releaseChild(childComponentView)
        reactChildren.unmount(childComponentView, at: index)
        if childComponentView === contentView { contentView = nil }
        if childComponentView === leftActionsView { leftActionsView = nil; requestedSides.remove(.left) }
        if childComponentView === rightActionsView { rightActionsView = nil; requestedSides.remove(.right) }
        super.unmountChildComponentView(childComponentView, index: index)
        let generation = workGeneration
        if let cancelled = cancelled { onGestureCancelled(cancelled) }
        guard generation == workGeneration else { return }
        reconcileChildRoles()
        scheduleReconciliation()
    }

    private func scheduleVisualRestore() {
        guard !isDetached, visualRestoreWorkItem == nil else { return }
        let generation = workGeneration
        let key = recyclingKey
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.visualRestoreWorkItem = nil
            guard self.isCurrent(generation, key: key), !self.isDragging, !self.isAnimating else { return }
            self.reconcileChildRoles()
            self.contentView?.transform = CGAffineTransform(translationX: self.currentTranslation, y: 0)
            self.updateActionsTransform()
        }
        visualRestoreWorkItem = item
        DispatchQueue.main.async(execute: item)
    }

    public override func layoutSubviews() {
        guard !isDetached else { return }
        guard !isDragging && !isAnimating else {
            reconcileChildRoles(); updateActionsTransform()
            return
        }
        super.layoutSubviews()
        reconcileChildRoles()
        for side in SwipeSide.allCases {
            guard let rail = actionsView(for: side) else { continue }
            // React aligns the caller's actions inside full-bounds slot shells.
            rail.bounds.size = bounds.size
            rail.center = CGPoint(x: bounds.midX, y: bounds.midY)
        }
        contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        updateActionsTransform()
        if currentTranslation != 0 { scheduleVisualRestore() }
    }

    // MARK: - Gesture handling

    func handleGestureStart() {
        commitProps()
        guard gestureEnabled, defaultOpenSide() != nil else { return }
        let side = currentSide
        guard invalidateWork() else { return }
        gestureSide = side
        directGesturePending = true
        startOffset = currentTranslation
        gestureStartedOpen = isOpen
        // Direct API has no direction at start. Latch when its first update arrives.
    }

    func handleGestureUpdate(translationX: CGFloat, velocityX: CGFloat) {
        if directGesturePending && !isGestureActivated {
            guard abs(translationX) >= dragOffsetFromEdge,
                  let side = gestureSide ?? SwipePhysics.latchedSide(
                    openSide: openSide, translation: translationX,
                    leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
                  ) else { return }
            gestureStartTranslation = dragOffsetFromEdge > 0 ? translationX : 0
            activateGesture(on: side)
        }
        guard isGestureActivated, let side = currentSide, width(for: side) > 0 else { return }
        let relative = translationX - gestureStartTranslation
        updateGesture(translation: relative, side: side)
    }

    func handleGestureEnd(translationX: CGFloat, velocityX: CGFloat) {
        guard isGestureActivated, let side = currentSide else {
            // A command already consumed this gesture. Its trailing end cannot
            // invalidate the animator that inherited the completion.
            directGesturePending = false
            return
        }
        let relative = translationX - gestureStartTranslation
        finishGesture(translation: relative, velocity: velocityX, side: side)
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard gestureEnabled, defaultOpenSide() != nil else { return }
        // Key/detach rebinding invalidates even a touch that was still .possible.
        guard panGesture.isCurrentBinding(commandTarget) else {
            ignoresPanUntilNextBegin = true
            return
        }
        // A command/configuration cancellation consumes the rest of this physical pan.
        // It must not reactivate on a later changed event or switch to the opposite edge.
        if ignoresPanUntilNextBegin && gesture.state != .began {
            if gesture.state == .ended || gesture.state == .cancelled { savedFirstResponder = nil }
            return
        }
        switch gesture.state {
        case .began:
            handlePanBegan(gesture)
        case .changed:
            handlePanChanged(gesture)
        case .ended:
            handlePanEnded(gesture)
        case .cancelled:
            let settledSide = openSide
            guard invalidateWork(preservePresentation: false) else { return }
            openSide = settledSide
            currentTranslation = settledSide.map { $0.sign * width(for: $0) } ?? 0
            contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
            updateActionsTransform()
            savedFirstResponder = nil
        default:
            break
        }
    }

    private func handlePanBegan(_ gesture: UIPanGestureRecognizer) {
        cancelFabricTouches()
        let interruptedSide = currentSide
        guard invalidateWork() else { return }
        ignoresPanUntilNextBegin = false
        gestureStartTranslation = gesture.translation(in: self).x
        gestureSide = interruptedSide
        if gestureSide == nil && dragOffsetFromEdge <= 0 {
            gestureSide = SwipePhysics.latchedSide(
                openSide: openSide, translation: gesture.velocity(in: self).x,
                leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
            )
        }
        if dragOffsetFromEdge <= 0, let side = gestureSide { activateGesture(on: side) }
    }

    private func handlePanChanged(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: self).x
        if !isGestureActivated {
            let relative = translation - gestureStartTranslation
            guard abs(relative) >= dragOffsetFromEdge else { return }
            let side = gestureSide ?? SwipePhysics.latchedSide(
                openSide: openSide, translation: relative,
                leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
            )
            guard let selected = side else { return }
            gestureStartTranslation = translation
            activateGesture(on: selected)
        }
        guard let side = currentSide else { return }
        updateGesture(translation: translation - gestureStartTranslation, side: side)
    }

    private func handlePanEnded(_ gesture: UIPanGestureRecognizer) {
        guard isGestureActivated, let side = currentSide else {
            gestureStartTranslation = 0
            savedFirstResponder = nil
            resetFeedback()
            return
        }
        finishGesture(
            translation: gesture.translation(in: self).x - gestureStartTranslation,
            velocity: gesture.velocity(in: self).x, side: side
        )
    }

    private func activateGesture(on side: SwipeSide) {
        let generation = workGeneration
        let key = recyclingKey
        gestureSide = side
        isGestureActivated = true
        isDragging = true
        startOffset = currentTranslation
        gestureStartedOpen = isOpen
        lastEmittedWillEndState = isOpen ? "open" : "closed"
        beginFeedback(on: side)
        requestActions(on: side)
        guard isCurrent(generation, key: key), isGestureActivated else { return }
        gestureCompletion.begin(recyclingKey: key, side: side)
        onSwipeStart(payload([:], side: side))
        guard isCurrent(generation, key: key), isGestureActivated else { return }
        startProgressUpdates()
    }

    private func updateGesture(translation: CGFloat, side: SwipeSide) {
        let raw = startOffset + translation * friction
        let constrained = SwipePhysics.constrainToSide(
            translation: raw, actionsWidth: width(for: side), side: side
        )
        currentTranslation = constrained
        contentView?.transform = CGAffineTransform(translationX: constrained, y: 0)
        updateFeedback(on: side, relativeTranslation: translation)
        updateActionsTransform()
        let wouldOpen = SwipePhysics.shouldSnapToOpen(
            projectedTranslation: translation * friction, actionsWidth: width(for: side), threshold: threshold,
            isLeading: side == .left, isCurrentlyOpen: gestureStartedOpen
        )
        emitIntendedState(wouldOpen, side: side)
    }

    private func emitIntendedState(_ willOpen: Bool, side: SwipeSide) {
        let state = willOpen ? "open" : "closed"
        if lastEmittedWillEndState != state {
            lastEmittedWillEndState = state
            onSwipeStateChange(payload(["state": state], side: side))
        }
    }

    private func finishGesture(
        translation: CGFloat, velocity: CGFloat, side: SwipeSide
    ) {
        let generation = workGeneration
        let key = recyclingKey
        isGestureActivated = false
        directGesturePending = false
        gestureStartTranslation = 0
        isDragging = false
        stopProgressUpdates()
        let willOpen = SwipePhysics.shouldOpenOnSide(
            translation: translation, velocity: velocity, friction: friction,
            actionsWidth: width(for: side), threshold: threshold, side: side,
            isCurrentlyOpen: gestureStartedOpen
        )
        emitIntendedState(willOpen, side: side)
        guard isCurrent(generation, key: key) else { return }
        if willOpen {
            beginOpen(on: side, preserveFeedback: true, preserveGestureCompletion: true)
            if autoClose, gestureCompletion.isPending, isOpen { scheduleAutoClose() }
        } else {
            performClose(animated: true, preserveGestureCompletion: true)
        }
    }

    // MARK: - Open/close

    func open(velocity: CGFloat = 0, intent: Int? = nil) {
        commitProps()
        // gestureEnabled controls the recognizer, not imperative commands.
        guard let side = defaultOpenSide() else { return }
        openResolvedSide(side, intent: intent ?? Self.currentIntent())
    }

    func open(side: SwipeSide, velocity: CGFloat = 0, intent: Int? = nil) {
        commitProps()
        // Keep explicit opens available with gestureEnabled=false, just like open().
        guard width(for: side) > 0 else { return }
        openResolvedSide(side, intent: intent ?? Self.currentIntent())
    }

    private func openResolvedSide(_ side: SwipeSide, intent: Int) {
        if let previous = currentSide, previous != side,
           isOpen || isAnimating || currentTranslation != 0 || gestureCompletion.isPending {
            // The side switch carries this intent through its closing leg.
            openIntent = intent
            performClose(animated: true) { [weak self] in
                guard let self = self, self.width(for: side) > 0 else { return }
                self.beginOpen(on: side, intent: intent)
            }
        } else {
            beginOpen(on: side, intent: intent)
        }
    }

    private func beginOpen(
        on side: SwipeSide, preserveFeedback: Bool = false, preserveGestureCompletion: Bool = false,
        intent: Int? = nil
    ) {
        // Imperative auto-close opens have no timer/end; all other same-side opens
        // can take over the owed completion without resetting the JS start gate.
        guard invalidateWork(
            resetAppearance: !preserveFeedback,
            preserveGestureCompletion: preserveGestureCompletion || !autoClose
        ) else { return }
        let generation = workGeneration
        let key = recyclingKey
        openSide = side
        openIntent = intent ?? Self.currentIntent()
        animationSide = side
        isAnimating = true
        persistOpenSide()
        requestActions(on: side)
        guard isCurrent(generation, key: key) else { return }
        let targetX = side.sign * width(for: side)
        startProgressUpdates()
        let animator = UIViewPropertyAnimator(
            duration: SwipeAnimationConfig.openDuration,
            dampingRatio: SwipeAnimationConfig.openDamping
        ) {
            self.contentView?.transform = CGAffineTransform(translationX: targetX, y: 0)
        }
        animator.addCompletion { [weak self] position in
            guard let self = self, position == .end, self.isCurrent(generation, key: key) else { return }
            self.currentTranslation = targetX
            self.isAnimating = false
            self.currentAnimator = nil
            self.animationSide = nil
            self.stopProgressUpdates()
            self.resetFeedback()
            self.updateActionsTransform()
            self.onSwipeProgress(self.payload(["progress": 1.0, "translationX": targetX], side: side))
            guard self.isCurrent(generation, key: key) else { return }
            // Programmatic opens with autoClose historically neither schedule a close nor emit end.
            if !self.autoClose { self.emitSwipeEnd("open", side: side) }
            guard self.isCurrent(generation, key: key) else { return }
            self.restoreFirstResponder()
        }
        currentAnimator = animator
        animator.startAnimation()
    }

    func snapToOpen() {
        commitProps()
        guard let side = defaultOpenSide() else { return }
        snapToOpen(side: side)
    }

    private func snapToOpen(side: SwipeSide, intent: Int? = nil) {
        guard invalidateWork() else { return }
        let generation = workGeneration
        let key = recyclingKey
        openSide = side
        openIntent = intent ?? Self.currentIntent()
        isAnimating = false
        currentTranslation = side.sign * width(for: side)
        contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        requestActions(on: side)
        guard isCurrent(generation, key: key) else { return }
        updateActionsTransform()
        onSwipeProgress(payload(["progress": 1.0, "translationX": currentTranslation], side: side))
    }

    func close(animated: Bool = true, velocity: CGFloat = 0) {
        performClose(animated: animated)
    }

    private func performClose(
        animated: Bool, endState: String = "closed", preserveGestureCompletion: Bool = false,
        completion: (() -> Void)? = nil
    ) {
        let side = currentSide
        // An animated close inherits pending completion ownership until it ends
        // or a later silent close/cancel sends the internal abandonment event.
        guard invalidateWork(
            preserveGestureCompletion: animated || preserveGestureCompletion || endState == "open"
        ) else { return }
        openSide = nil
        animationSide = side
        if endState == "open", let side = side {
            autoCloseState = .closing(side: side)
        }
        // Every explicit close clears cached intent, including instant resets.
        persistOpenSide()
        if !animated {
            currentTranslation = 0
            animationSide = nil
            savedFirstResponder = nil
            contentView?.transform = .identity
            updateActionsTransform()
            return
        }
        isAnimating = true
        let generation = workGeneration
        let key = recyclingKey
        startProgressUpdates()
        let animator = UIViewPropertyAnimator(
            duration: SwipeAnimationConfig.closeDuration,
            dampingRatio: SwipeAnimationConfig.closeDamping
        ) {
            self.contentView?.transform = .identity
        }
        animator.addCompletion { [weak self] position in
            guard let self = self, position == .end, self.isCurrent(generation, key: key) else { return }
            self.currentTranslation = 0
            self.isAnimating = false
            self.currentAnimator = nil
            self.stopProgressUpdates()
            self.updateActionsTransform()
            self.onSwipeProgress(self.payload(["progress": 0.0, "translationX": 0.0], side: side))
            guard self.isCurrent(generation, key: key) else { return }
            self.autoCloseState = nil
            self.emitSwipeEnd(endState, side: side)
            guard self.isCurrent(generation, key: key) else { return }
            self.animationSide = nil
            self.resetFeedback()
            self.restoreFirstResponder()
            if self.isCurrent(generation, key: key) { completion?() }
        }
        currentAnimator = animator
        animator.startAnimation()
    }

    private func emitSwipeEnd(_ state: String, side: SwipeSide?) {
        gestureCompletion.complete()
        onSwipeEnd(payload(["state": state], side: side))
    }

    private func restoreFirstResponder() {
        if let saved = savedFirstResponder, !saved.isFirstResponder { saved.becomeFirstResponder() }
        savedFirstResponder = nil
    }
}

// MARK: - UIGestureRecognizerDelegate

extension SwipeableView: UIGestureRecognizerDelegate {

    public override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        if pan === panGesture && !panGesture.isCurrentBinding(commandTarget) { return false }
        let velocity = pan.velocity(in: self)
        let isHorizontal = abs(velocity.x) > abs(velocity.y)
        guard isHorizontal else { return false }
        let shouldBegin: Bool
        guard gestureEnabled else { return false }
        let side = currentSide ?? SwipePhysics.latchedSide(
            openSide: openSide, translation: velocity.x,
            leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
        )
        shouldBegin = side.map { width(for: $0) > 0 } ?? false

        if shouldBegin {
            // Yield to any child-owned recognizer, including RNGH recognizers
            // whose delegates cannot participate in our failure ordering.
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
