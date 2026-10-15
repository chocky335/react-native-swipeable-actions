import ExpoModulesCore
import UIKit

#if canImport(React)
import React
#endif

extension UIView: SwipeChildVisibility {}

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

    private static func setOpenState(for key: String, side: SwipeSide?, owner: SwipeableView) {
        let identity = ObjectIdentifier(owner)
        registryQueue.async {
            // A recycled/detached view must not overwrite its replacement's state.
            if let current = _viewRegistry[key]?.value, ObjectIdentifier(current) != identity { return }
            _openStateCache.set(side, for: key)
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

    private static func enqueueCommand(for key: String, _ command: @escaping (SwipeableView) -> Void) {
        guard let target = registryQueue.sync(execute: { _viewRegistry[key] }) else { return }
        DispatchQueue.main.async {
            performCommand(command, for: key, target: target)
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

    static func openByKey(_ key: String) {
        enqueueCommand(for: key) { $0.open() }
    }

    static func openByKeyOnSide(_ key: String, side: String) {
        guard let side = SwipeSide(rawValue: side) else { return }
        enqueueCommand(for: key) { $0.open(side: side) }
    }

    static func closeByKey(_ key: String, animated: Bool = true) {
        let target = registryQueue.sync {
            // Consume unbound intent before a remount can read the cached side.
            _openStateCache.captureCloseTarget(for: key, current: _viewRegistry[key])
        }
        guard let target = target else { return }
        DispatchQueue.main.async {
            performCommand({ $0.close(animated: animated) }, for: key, target: target)
            // A close for an unmounted row must also cancel its cached restore.
            // Never clear a replacement/reattached binding rejected by performCommand.
            registryQueue.sync {
                _openStateCache.clearIfUnbound(
                    for: key, hasCurrentBinding: _viewRegistry[key]?.value != nil
                )
            }
        }
    }

    static func cancelByKey(_ key: String) {
        enqueueCommand(for: key) { $0.cancelGesture() }
    }

    /// Close all swipeables. When animated=true, only closes open views. When animated=false, resets all views.
    static func closeAll(animated: Bool = true) {
        let targets = registryQueue.sync { _viewRegistry.map { (key: $0.key, target: $0.value) } }
        DispatchQueue.main.async {
            for entry in targets {
                performCommand({ view in
                    if !animated || SwipePhysics.shouldCloseForCloseAll(
                        isOpen: view.isOpen, twoSided: view.twoSided, isAnimating: view.isAnimating,
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

    private var legacyActionsView: UIView?
    private var leftActionsView: UIView?
    private var rightActionsView: UIView?
    private var contentView: UIView?
    private let railVisibility = SwipeRailVisibility()
    // Fabric mount order, not UIView.subviews (which can contain UIKit/Expo helpers).
    private var reactChildren = SwipeReactChildren<UIView>()
    private var assignedTwoSided = false
    private var awaitingChildProtocol = false
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
    private var reconciliationWorkItem: DispatchWorkItem?
    private var visualRestoreWorkItem: DispatchWorkItem?
    private var requestedSides: Set<SwipeSide> = []
    private var slotChildren: [SwipeSide: [ObjectIdentifier]] = [:]

    private struct LayoutConfiguration: Equatable {
        var twoSided: Bool
        var legacyWidth: CGFloat
        var leftWidth: CGFloat
        var rightWidth: CGFloat
        var position: String
        var enabled: Bool
        var friction: CGFloat
        var threshold: CGFloat
        var dragOffset: CGFloat
        var autoClose: Bool
        var autoCloseTimeout: CGFloat
    }
    private var appliedConfiguration = LayoutConfiguration(
        twoSided: false, legacyWidth: 0, leftWidth: 0, rightWidth: 0, position: "right", enabled: true,
        friction: 1, threshold: 0.4, dragOffset: 0, autoClose: false, autoCloseTimeout: 0
    )

    // MARK: - Props

    var actionsWidth: CGFloat = 0 {
        didSet {
            let validated = max(0, actionsWidth)
            if validated != actionsWidth {
                actionsWidth = validated
                return
            }
            guard actionsWidth != oldValue else { return }
            scheduleReconciliation()
        }
    }

    var twoSided = false {
        didSet { if twoSided != oldValue { scheduleReconciliation() } }
    }

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

    var actionsPosition = "right" {
        didSet {
            if actionsPosition != "left" && actionsPosition != "right" {
                actionsPosition = "right"
                return
            }
            guard actionsPosition != oldValue else { return }
            scheduleReconciliation()
        }
    }
    var isLeading: Bool { actionsPosition == "left" }
    private var legacySide: SwipeSide { isLeading ? .left : .right }

    var friction: CGFloat = 1.0 {
        didSet {
            friction = max(0.0, min(1.0, friction))
            if twoSided && friction != oldValue { scheduleReconciliation() }
        }
    }
    var threshold: CGFloat = 0.4 {
        didSet {
            threshold = max(0.0, min(1.0, threshold))
            if twoSided && threshold != oldValue { scheduleReconciliation() }
        }
    }
    var gestureEnabled = true {
        didSet {
            guard gestureEnabled != oldValue else { return }
            if !twoSided {
                // Preserve legacy immediate disabling and its nonanimated cache behavior.
                if !gestureEnabled {
                    abortActiveGesture()
                    panGesture.isEnabled = false
                    if isOpen || currentTranslation != 0 { close(animated: false) }
                    else { invalidateWork() }
                } else {
                    panGesture.isEnabled = true
                }
            }
            scheduleReconciliation()
        }
    }
    /// Explicit cancellation consumes the rest of the pan and any pending reopen,
    /// but leaves the binding identity intact for later commands in the same JS turn.
    func cancelGesture() {
        ignoresPanUntilNextBegin = true
        abortActiveGesture()
        performClose(animated: false)
        persistOpenSide()
        panGesture.isEnabled = false
        panGesture.isEnabled = gestureEnabled
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
            if twoSided && dragOffsetFromEdge != oldValue { scheduleReconciliation() }
        }
    }
    var autoClose = false {
        didSet {
            if twoSided && autoClose != oldValue {
                cancelAutoClose()
                scheduleReconciliation()
            }
        }
    }
    var autoCloseTimeout: CGFloat = 0 {
        didSet {
            autoCloseTimeout = max(0, autoCloseTimeout)
            if twoSided && autoCloseTimeout != oldValue { scheduleReconciliation() }
        }
    }

    var recyclingKey: String? {
        didSet {
            guard oldValue != recyclingKey else { return }
            commandTarget = SwipeCommandTarget(self)
            let restored = recyclingKey.flatMap { Self.getOpenSide(for: $0) }
                .flatMap { SwipeSide(rawValue: $0) }
            if let old = oldValue {
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
            pendingRestoreSide = restored
            if let key = recyclingKey, !isDetached { Self.registerView(self, for: key) }
            // Widths and layout mode may follow the key in the same Expo prop transaction.
            scheduleReconciliation()
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
    private var currentSide: SwipeSide? {
        twoSided ? (gestureSide ?? animationSide ?? openSide) : legacySide
    }
    private var actionsView: UIView? {
        guard let side = currentSide else { return nil }
        return actionsView(for: side)
    }

    private func width(for side: SwipeSide) -> CGFloat {
        if twoSided { return side == .left ? leftActionsWidth : rightActionsWidth }
        return side == legacySide ? actionsWidth : 0
    }

    private func actionsView(for side: SwipeSide) -> UIView? {
        if !twoSided { return side == legacySide ? legacyActionsView : nil }
        return side == .left ? leftActionsView : rightActionsView
    }

    private func defaultOpenSide() -> SwipeSide? {
        if !twoSided { return legacySide }
        if width(for: legacySide) > 0 { return legacySide }
        return SwipeSide.allCases.first { width(for: $0) > 0 }
    }

    private func payload(_ values: [String: Any], side: SwipeSide?) -> [String: Any] {
        guard twoSided else { return values }
        var result = values
        if let side = side { result["side"] = side.rawValue }
        // Capture identity before EventDispatcher queues delivery to JavaScript.
        if let key = recyclingKey { result["recyclingKey"] = key }
        return result
    }

    private func persistOpenSide() {
        if let key = recyclingKey { Self.setOpenState(for: key, side: openSide, owner: self) }
    }

    private func isCurrent(_ generation: Int, key: String?) -> Bool {
        !isDetached && workGeneration == generation && recyclingKey == key
    }

    private func requestActions(on side: SwipeSide) {
        guard !twoSided || width(for: side) > 0 else { return }
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
            twoSided: twoSided,
            legacyWidth: twoSided ? 0 : actionsWidth,
            leftWidth: twoSided ? leftActionsWidth : 0,
            rightWidth: twoSided ? rightActionsWidth : 0,
            position: actionsPosition,
            enabled: gestureEnabled, friction: friction, threshold: threshold,
            dragOffset: dragOffsetFromEdge, autoClose: autoClose, autoCloseTimeout: autoCloseTimeout
        )
        let previous = appliedConfiguration
        appliedConfiguration = next
        var cancelledGesture: [String: Any]?
        var resumeAutoClose: SwipeAutoCloseState?
        if next != previous && (next.twoSided || previous.twoSided) {
            let ownedCompletion = isGestureActivated || gestureCompletion.isPending
            let cancellationPayload = payload([:], side: currentSide)
            if panGesture.state == .began || panGesture.state == .changed {
                ignoresPanUntilNextBegin = true
            }
            let logicalSide = openSide
            let reconciled = SwipePhysics.reconcileTwoSidedState(
                openSide: logicalSide,
                autoCloseState: next.twoSided && previous.twoSided ? autoCloseState : nil,
                leftWidth: width(for: .left), rightWidth: width(for: .right),
                wasGestureEnabled: previous.enabled, gestureEnabled: gestureEnabled, autoClose: autoClose
            )
            let presentation = contentView?.layer.presentation()?.transform.m41 ?? currentTranslation
            let preservesCompletion = reconciled.autoClose != nil
            if ownedCompletion && !preservesCompletion { cancelledGesture = cancellationPayload }
            invalidateWork(
                preservePresentation: false, clearRestore: false,
                preserveGestureCompletion: preservesCompletion
            )
            requestedSides.removeAll()
            if next.twoSided != previous.twoSided {
                releaseChildRoles()
                awaitingChildProtocol = true
            }
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
        if !next.twoSided && !previous.twoSided && SwipePhysics.shouldSyncOpenWidth(
            oldWidth: previous.legacyWidth, newWidth: next.legacyWidth, isOpen: isOpen,
            isInteracting: isDragging || isAnimating || isGestureActivated
        ) {
            syncOpenStateToCurrentWidth()
        }
        if let cachedSide = pendingRestoreSide {
            let side = twoSided ? cachedSide : legacySide
            if twoSided && (width(for: side) <= 0 || !gestureEnabled) {
                pendingRestoreSide = nil
                openSide = nil
                currentTranslation = 0
                persistOpenSide()
            } else if contentView != nil {
                pendingRestoreSide = nil
                snapToOpen(side: side)
            } else if twoSided {
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
        if let cancelled = cancelledGesture { onGestureCancelled(cancelled) }
    }

    private func invalidateWork(
        preservePresentation: Bool = true,
        clearRestore: Bool = true,
        preserveGestureCompletion: Bool = false
    ) {
        gestureCompletion.invalidate(preserving: preserveGestureCompletion)
        if twoSided && (panGesture.state == .began || panGesture.state == .changed) {
            ignoresPanUntilNextBegin = true
        }
        workGeneration += 1
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
        resetActionTransforms()
    }

    // Release native-owned presentation without changing the rail's position.
    private func resetActionTransforms() {
        for view in [legacyActionsView, leftActionsView, rightActionsView].compactMap({ $0 }) {
            view.transform = CGAffineTransform(translationX: view.transform.tx, y: view.transform.ty)
        }
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

    private lazy var panGesture: UIPanGestureRecognizer = {
        let gesture = UIPanGestureRecognizer(target: self, action: #selector(handlePan))
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
        if let key = recyclingKey { Self.unregisterView(self, for: key) }
    }

    private var hasPendingInteraction: Bool {
        isAnimating || isDragging || isGestureActivated || directGesturePending || autoCloseWorkItem != nil
    }

    private func suspendForDetach() {
        guard !isDetached else { return }
        let preservesCachedSide = SwipePhysics.shouldRestoreAfterDetach(
            twoSided: twoSided, hasPendingInteraction: hasPendingInteraction
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
            // Legacy detach follows main's closed reset. New-mode restoration is
            // cache-driven and only preserves settled intent, never unfinished work.
            if !preservesCachedSide { Self.setOpenState(for: key, side: nil, owner: self) }
            Self.unregisterView(self, for: key)
        }
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
        if let key = recyclingKey {
            Self.registerView(self, for: key)
            if wasDetached && twoSided {
                // Read again: a closeByKey while detached may have cleared the cache.
                pendingRestoreSide = Self.getOpenSide(for: key).flatMap { SwipeSide(rawValue: $0) }
            }
        }
        if panGesture.view !== self {
            panGesture.view?.removeGestureRecognizer(panGesture)
            addGestureRecognizer(panGesture)
        }
        commitProps()
        if twoSided { scheduleVisualRestore() }
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
        if twoSided, let side = openSide {
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
                  !self.twoSided || self.autoClose else { return }
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
        let progress = twoSided ? min(rawProgress, 1) : rawProgress
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
            rail.transform = CGAffineTransform(translationX: offset, y: 0)
            if twoSided {
                let revealed = active && sideWidth > 0 && side.sign * translation > 0
                railVisibility.setRevealed(revealed, for: rail)
            }
        }
    }

    private func syncOpenStateToCurrentWidth() {
        let targetX = legacySide.sign * actionsWidth
        currentTranslation = targetX
        contentView?.transform = CGAffineTransform(translationX: targetX, y: 0)
        if let actions = legacyActionsView {
            actions.transform = .identity
        } else {
            onSwipeStart([:])
        }
        onSwipeProgress(["progress": 1.0, "translationX": targetX])
    }

    // MARK: - React child roles

    private func releaseChild(_ view: UIView) {
        railVisibility.release(view)
        view.transform = .identity
        view.layer.zPosition = 0
    }

    private func releaseChildRoles() {
        for view in [legacyActionsView, leftActionsView, rightActionsView, contentView].compactMap({ $0 }) {
            releaseChild(view)
        }
        railVisibility.releaseAll()
        legacyActionsView = nil
        leftActionsView = nil
        rightActionsView = nil
        contentView = nil
        slotChildren.removeAll()
    }

    private func reconcileChildRoles() {
        guard !isDetached else { return }
        let children = reactChildren.views
        if assignedTwoSided != twoSided {
            releaseChildRoles()
            assignedTwoSided = twoSided
            awaitingChildProtocol = true
        }
        // On removal, preserve surviving identities instead of promoting a rail to content.
        if let view = contentView, !children.contains(where: { $0 === view }) { releaseChild(view); contentView = nil }
        if let view = leftActionsView, !children.contains(where: { $0 === view }) { releaseChild(view); leftActionsView = nil }
        if let view = rightActionsView, !children.contains(where: { $0 === view }) { releaseChild(view); rightActionsView = nil }
        if let view = legacyActionsView, !children.contains(where: { $0 === view }) { releaseChild(view); legacyActionsView = nil }
        if awaitingChildProtocol && !twoSided && children.count > 2 { return }
        guard let roles = SwipePhysics.childRoles(count: children.count, twoSided: twoSided) else { return }
        awaitingChildProtocol = false
        let previousLeft = leftActionsView
        let previousRight = rightActionsView
        let previousLegacy = legacyActionsView
        contentView = children[roles.content]
        // A complete Fabric transaction can give a previously hidden rail the content role.
        // Restore only flags that this view owned, in both legacy and two-sided layouts.
        if let contentView = contentView { railVisibility.release(contentView) }
        if twoSided {
            leftActionsView = roles.left.map { children[$0] }
            rightActionsView = roles.right.map { children[$0] }
            if previousLeft !== leftActionsView { requestedSides.remove(.left) }
            if previousRight !== rightActionsView { requestedSides.remove(.right) }
        } else {
            legacyActionsView = roles.actions.map { children[$0] }
            if previousLegacy !== legacyActionsView { requestedSides.remove(legacySide) }
            if previousLegacy == nil && legacyActionsView != nil && (isOpen || isAnimating) {
                legacyActionsView?.transform = .identity
            }
        }
        contentView?.layer.zPosition = 1
        for side in SwipeSide.allCases {
            guard let rail = actionsView(for: side) else { continue }
            rail.layer.zPosition = -1
            if twoSided {
                let children = rail.subviews.map { ObjectIdentifier($0) }
                if let previous = slotChildren[side], !previous.isEmpty && previous != children {
                    requestedSides.remove(side)
                }
                slotChildren[side] = children
            }
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
        if childComponentView === legacyActionsView { legacyActionsView = nil; requestedSides.remove(legacySide) }
        if childComponentView === leftActionsView { leftActionsView = nil; requestedSides.remove(.left) }
        if childComponentView === rightActionsView { rightActionsView = nil; requestedSides.remove(.right) }
        super.unmountChildComponentView(childComponentView, index: index)
        reconcileChildRoles()
        scheduleReconciliation()
    }

    private func scheduleVisualRestore() {
        guard twoSided, !isDetached, visualRestoreWorkItem == nil else { return }
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
            if twoSided { reconcileChildRoles(); updateActionsTransform() }
            return
        }
        super.layoutSubviews()
        reconcileChildRoles()
        for side in SwipeSide.allCases {
            guard let rail = actionsView(for: side) else { continue }
            if twoSided {
                // React aligns the caller's actions inside full-bounds slot shells.
                rail.bounds.size = bounds.size
                rail.center = CGPoint(x: bounds.midX, y: bounds.midY)
            } else {
                var frame = rail.frame
                frame.size.height = bounds.height
                rail.frame = frame
            }
        }
        contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        updateActionsTransform()
        if currentTranslation != 0 { scheduleVisualRestore() }
    }

    // MARK: - Gesture handling

    func handleGestureStart() {
        commitProps()
        guard gestureEnabled, defaultOpenSide() != nil, twoSided || actionsWidth > 0 else { return }
        if twoSided {
            let side = currentSide
            invalidateWork()
            gestureSide = side
            directGesturePending = true
            startOffset = currentTranslation
            gestureStartedOpen = isOpen
            // Direct API has no direction at start. Latch when its first update arrives.
            return
        }
        // Legacy direct handlers intentionally have no clamp, state callbacks or auto-close.
        gestureSide = legacySide
        isDragging = true
        startOffset = currentTranslation
        gestureStartedOpen = isOpen
        gestureStartTranslation = 0
        isGestureActivated = true

        requestActions(on: legacySide)
        onSwipeStart([:])
        startProgressUpdates()
    }

    func handleGestureUpdate(translationX: CGFloat, velocityX: CGFloat) {
        if twoSided && directGesturePending && !isGestureActivated {
            guard abs(translationX) >= dragOffsetFromEdge,
                  let side = gestureSide ?? SwipePhysics.latchedSide(
                    openSide: openSide, translation: translationX,
                    leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
                  ) else { return }
            gestureStartTranslation = dragOffsetFromEdge > 0 ? translationX : 0
            activateGesture(on: side)
        }
        guard isGestureActivated, let side = currentSide, width(for: side) > 0 else { return }
        let relative = twoSided ? translationX - gestureStartTranslation : translationX
        updateGesture(translation: relative, side: side, clamp: twoSided, emitState: twoSided)
    }

    func handleGestureEnd(translationX: CGFloat, velocityX: CGFloat) {
        guard isGestureActivated, let side = currentSide else {
            if twoSided { invalidateWork() }
            return
        }
        let relative = twoSided ? translationX - gestureStartTranslation : translationX
        finishGesture(translation: relative, velocity: velocityX, side: side, emitState: twoSided, allowAutoClose: twoSided)
    }

    @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
        guard gestureEnabled, twoSided ? defaultOpenSide() != nil : actionsWidth > 0 else { return }
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
            if twoSided {
                let cancelled = isGestureActivated ? payload([:], side: currentSide) : nil
                let settledSide = openSide
                invalidateWork(preservePresentation: false)
                openSide = settledSide
                currentTranslation = settledSide.map { $0.sign * width(for: $0) } ?? 0
                contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
                updateActionsTransform()
                savedFirstResponder = nil
                if let cancelled = cancelled { onGestureCancelled(cancelled) }
            } else {
                // The original pan treats cancellation as release. Preserve its callbacks.
                resetActionTransforms()
                handlePanEnded(gesture)
            }
        default:
            break
        }
    }

    private func handlePanBegan(_ gesture: UIPanGestureRecognizer) {
        cancelFabricTouches()
        let interruptedSide = currentSide
        invalidateWork()
        ignoresPanUntilNextBegin = false
        gestureStartTranslation = gesture.translation(in: self).x
        if twoSided {
            gestureSide = interruptedSide
            if gestureSide == nil && dragOffsetFromEdge <= 0 {
                gestureSide = SwipePhysics.latchedSide(
                    openSide: openSide, translation: gesture.velocity(in: self).x,
                    leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
                )
            }
        } else {
            gestureSide = legacySide
        }
        if dragOffsetFromEdge <= 0, let side = gestureSide { activateGesture(on: side) }
    }

    private func handlePanChanged(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: self).x
        if !isGestureActivated {
            let relative = translation - gestureStartTranslation
            guard abs(relative) >= dragOffsetFromEdge else { return }
            let side = gestureSide ?? (twoSided ? SwipePhysics.latchedSide(
                openSide: openSide, translation: relative,
                leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
            ) : legacySide)
            guard let selected = side else { return }
            gestureStartTranslation = translation
            activateGesture(on: selected)
        }
        guard let side = currentSide else { return }
        updateGesture(translation: translation - gestureStartTranslation, side: side, clamp: true, emitState: true)
    }

    private func handlePanEnded(_ gesture: UIPanGestureRecognizer) {
        guard isGestureActivated, let side = currentSide else {
            gestureStartTranslation = 0
            savedFirstResponder = nil
            resetActionTransforms()
            return
        }
        finishGesture(
            translation: gesture.translation(in: self).x - gestureStartTranslation,
            velocity: gesture.velocity(in: self).x, side: side, emitState: true, allowAutoClose: true
        )
    }

    private func activateGesture(on side: SwipeSide) {
        gestureSide = side
        isGestureActivated = true
        isDragging = true
        startOffset = currentTranslation
        gestureStartedOpen = isOpen
        lastEmittedWillEndState = isOpen ? "open" : "closed"

        requestActions(on: side)
        if twoSided { gestureCompletion.begin() }
        onSwipeStart([:])
        startProgressUpdates()
    }

    private func updateGesture(translation: CGFloat, side: SwipeSide, clamp: Bool, emitState: Bool) {
        let raw = startOffset + translation * friction
        let constrained: CGFloat
        if twoSided {
            constrained = SwipePhysics.constrainToSide(
                translation: raw, actionsWidth: width(for: side), side: side
            )
        } else {
            let translation = clamp ? (isLeading ? max(0, raw) : min(0, raw)) : raw
            constrained = SwipePhysics.applyRubberBand(
                translation: translation, actionsWidth: actionsWidth, isLeading: isLeading
            )
        }
        currentTranslation = constrained
        contentView?.transform = CGAffineTransform(translationX: constrained, y: 0)

        updateActionsTransform()
        if emitState {
            // Legacy pan uses absolute drag position here; do not change its event cadence.
            let projected = twoSided ? translation * friction : constrained
            let wouldOpen = SwipePhysics.shouldSnapToOpen(
                projectedTranslation: projected, actionsWidth: width(for: side), threshold: threshold,
                isLeading: side == .left, isCurrentlyOpen: twoSided ? gestureStartedOpen : isOpen
            )
            emitIntendedState(wouldOpen, side: side)
        }
    }

    private func emitIntendedState(_ willOpen: Bool, side: SwipeSide) {
        let state = willOpen ? "open" : "closed"
        if lastEmittedWillEndState != state {
            lastEmittedWillEndState = state
            onSwipeStateChange(payload(["state": state], side: side))
        }
    }

    private func finishGesture(
        translation: CGFloat, velocity: CGFloat, side: SwipeSide, emitState: Bool, allowAutoClose: Bool
    ) {
        isGestureActivated = false
        directGesturePending = false
        gestureStartTranslation = 0
        isDragging = false
        stopProgressUpdates()
        let willOpen = SwipePhysics.shouldOpenOnSide(
            translation: translation, velocity: velocity, friction: friction,
            actionsWidth: width(for: side), threshold: threshold, side: side,
            isCurrentlyOpen: twoSided ? gestureStartedOpen : isOpen
        )
        if emitState { emitIntendedState(willOpen, side: side) }
        if willOpen {
            beginOpen(on: side, preserveGestureCompletion: true)
            if allowAutoClose && autoClose { scheduleAutoClose() }
        } else {
            performClose(animated: true, preserveGestureCompletion: true)
        }
    }

    // MARK: - Open/close

    func open(velocity: CGFloat = 0) {
        commitProps()
        // gestureEnabled controls the recognizer, not imperative commands.
        guard let side = defaultOpenSide() else { return }
        openResolvedSide(side)
    }

    func open(side: SwipeSide, velocity: CGFloat = 0) {
        commitProps()
        // Keep explicit opens available with gestureEnabled=false, just like open().
        guard width(for: side) > 0 else { return }
        openResolvedSide(side)
    }

    private func openResolvedSide(_ side: SwipeSide) {
        if twoSided, let previous = currentSide, previous != side,
           isOpen || isAnimating || currentTranslation != 0 {
            performClose(animated: true) { [weak self] in
                guard let self = self, self.width(for: side) > 0 else { return }
                self.beginOpen(on: side)
            }
        } else {
            beginOpen(on: side)
        }
    }

    private func beginOpen(on side: SwipeSide, preserveGestureCompletion: Bool = false) {
        invalidateWork(preserveGestureCompletion: preserveGestureCompletion)
        openSide = side
        animationSide = side
        isAnimating = true
        persistOpenSide()
        requestActions(on: side)
        let targetX = side.sign * width(for: side)
        let generation = workGeneration
        let key = recyclingKey
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
            self.resetActionTransforms()
            self.updateActionsTransform()
            self.onSwipeProgress(self.payload(["progress": 1.0, "translationX": targetX], side: side))
            // Programmatic opens with autoClose historically neither schedule a close nor emit end.
            if !self.autoClose { self.emitSwipeEnd("open", side: side) }
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

    private func snapToOpen(side: SwipeSide) {
        openSide = side
        isAnimating = false
        currentTranslation = side.sign * width(for: side)
        contentView?.transform = CGAffineTransform(translationX: currentTranslation, y: 0)
        requestActions(on: side)
        if !twoSided && legacyActionsView == nil {
            // Keep the historical legacy restore start callback, including raw native users.
            onSwipeStart([:])
        }
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
        invalidateWork(preserveGestureCompletion: preserveGestureCompletion || endState == "open")
        openSide = nil
        animationSide = side
        if twoSided && endState == "open", let side = side {
            autoCloseState = .closing(side: side)
        }
        // Instant legacy resets deliberately preserve cache; explicit two-sided closes clear it.
        if animated || twoSided { persistOpenSide() }
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
            self.autoCloseState = nil
            self.emitSwipeEnd(endState, side: side)
            self.animationSide = nil
            self.resetActionTransforms()
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
        let velocity = pan.velocity(in: self)
        let isHorizontal = abs(velocity.x) > abs(velocity.y)
        guard isHorizontal else { return false }
        let shouldBegin: Bool
        if twoSided {
            guard gestureEnabled else { return false }
            let side = currentSide ?? SwipePhysics.latchedSide(
                openSide: openSide, translation: velocity.x,
                leftWidth: leftActionsWidth, rightWidth: rightActionsWidth
            )
            shouldBegin = side.map { width(for: $0) > 0 } ?? false
        } else {
            shouldBegin = isOpen || (isLeading ? velocity.x > 0 : velocity.x < 0)
        }

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
