package expo.modules.swipeable

import android.content.Context
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import androidx.collection.LruCache
import androidx.dynamicanimation.animation.DynamicAnimation
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.events.NativeGestureUtil
import com.facebook.react.views.view.ReactViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import kotlin.math.abs

class SwipeableView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

    companion object {
        private const val MAX_CACHE_SIZE = 1000
        private const val GESTURE_TIMEOUT_MS = 5000L

        /** Thread-safe LRU cache for open state - prevents unbounded memory growth */
        private val openStateCache = LruCache<String, SwipeSide>(MAX_CACHE_SIZE)

        /** View registry for static method access by recyclingKey */
        private val viewRegistry = mutableMapOf<String, WeakReference<SwipeableView>>()

        /** Lock for thread-safe registry access */
        private val registryLock = Any()

        // LruCache synchronizes access internally; absence represents closed.
        private fun getOpenState(key: String): Boolean = openStateCache[key] != null

        private fun setOpenState(key: String, side: SwipeSide?) {
            if (side == null) openStateCache.remove(key) else openStateCache.put(key, side)
        }

        private fun getView(key: String): SwipeableView? = synchronized(registryLock) {
            viewRegistry[key]?.get()
        }

        private fun registerView(view: SwipeableView, key: String) = synchronized(registryLock) {
            viewRegistry[key] = WeakReference(view)
        }

        private fun unregisterView(view: SwipeableView, key: String) = synchronized(registryLock) {
            if (viewRegistry[key]?.get() === view) viewRegistry.remove(key)
        }

        private fun getAllViews(): List<SwipeableView> = synchronized(registryLock) {
            viewRegistry.values.mapNotNull { it.get() }
        }

        private fun postCommand(key: String, action: (SwipeableView) -> Unit) {
            val view = getView(key) ?: return
            view.postCommand {
                if (view.recyclingKey == key) action(view)
            }
        }

        // Keep the existing command signatures unchanged.
        fun openByKey(key: String) = postCommand(key) { it.open() }

        fun openByKeyOnSide(key: String, side: SwipeSide?) {
            if (side != null) postCommand(key) { it.open(side) }
        }

        fun getOpenSideByKey(key: String): String? = openStateCache[key]?.value

        fun closeByKey(key: String, animated: Boolean = true) {
            val view = synchronized(registryLock) {
                getView(key).also { current ->
                    // Clear unbound intent before a remount can restore it. Queue no
                    // work in this case: a future binding owns its own cached intent.
                    if (current == null) setOpenState(key, null)
                }
            } ?: return
            view.postCommand {
                if (view.recyclingKey == key) view.close(animated)
            }
        }

        fun cancelByKey(key: String) = postCommand(key) { it.cancelGesture() }

        /** Include pending interactions and closing continuations, not only settled open rows. */
        fun closeAll(animated: Boolean = true) {
            getAllViews().forEach { view ->
                view.postCommand {
                    // Earlier commands for this binding may still be queued.
                    val activeInteraction = (view.isAnimating || view.isDragging ||
                        view.directGesturePending || view.restorePending)
                    if (!animated || view.isOpen || activeInteraction) view.close(animated)
                }
            }
        }

        /** Clear all cached state - useful for app reset scenarios */
        fun clearCache() {
            openStateCache.evictAll()
        }

        /** Check if a recyclingKey is cached as open (for JS-side state initialization) */
        fun isOpenByKey(key: String): Boolean = getOpenState(key)
    }

    private val density = context.resources.displayMetrics.density

    private val actionsWidthPx: Float
        get() = activeSide?.let(::widthFor) ?: 0f

    var leftActionsWidth: Float = 0f
        set(value) {
            val width = validWidth(value)
            if (field == width) return
            field = width
            leftWidthPx = width * density
            configurationChanged()
        }

    var rightActionsWidth: Float = 0f
        set(value) {
            val width = validWidth(value)
            if (field == width) return
            field = width
            rightWidthPx = width * density
            configurationChanged()
        }

    private var leftWidthPx = 0f
    private var rightWidthPx = 0f

    val isLeading: Boolean get() = activeSide == SwipeSide.LEFT

    var friction: Float = 1.0f
        set(value) { field = value.coerceIn(0f, 1f) }

    var threshold: Float = 0.4f
        set(value) { field = value.coerceIn(0f, 1f) }

    var gestureEnabled: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            pendingGestureDisable = !value
            configurationChanged()
        }

    /**
     * Cancels an in-flight gesture and snaps the view back to closed.
     * Use from `onSwipeStart` to abort a swipe before it can complete.
     * The current touch sequence is suppressed until the next ACTION_DOWN
     * so the user can't reactivate the swipe by continuing the same drag —
     * including the case where cancel is called between ACTION_DOWN and
     * gesture activation (before any horizontal motion is detected).
     */
    fun cancelGesture() {
        isCurrentTouchCancelled = true
        velocityTracker?.recycle()
        velocityTracker = null
        // Cancel even at zero: a side may be pending activation, restoration,
        // or the first spring frame. Do not apply a pending restore first.
        closeInternal(animated = false)
    }

    private fun suppressCancelledTouch(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) isCurrentTouchCancelled = false
        return isCurrentTouchCancelled
    }

    var dragOffsetFromEdge: Float = 0f
        set(value) { field = maxOf(0f, value) }

    var autoClose: Boolean = false

    var autoCloseTimeout: Float = 0f  // milliseconds
        set(value) { field = maxOf(0f, value) }

    private val dragOffsetFromEdgePx: Float
        get() = dragOffsetFromEdge * density

    /** A rebind invalidates old work before restoring from the complete prop transaction. */
    var recyclingKey: String? = null
        set(value) {
            val oldValue = field
            if (oldValue == value) return
            val cancelled = takeGestureCancellation()
            bindingGeneration++
            val restoredSide = value?.let { openStateCache[it] }
            if (oldValue != null) {
                if (getView(oldValue) === this) {
                    setOpenState(oldValue, if (isOpen) openSide else null)
                }
                unregisterView(this, oldValue)
            }
            // A rebind consumes even a not-yet-activated physical sequence.
            // cancelActiveWork clears activation, so suppress before clearing it.
            isCurrentTouchCancelled = true
            velocityTracker?.recycle()
            velocityTracker = null
            cancelActiveWork()
            isOpen = false
            openSide = null
            animationSide = null
            resetPosition()
            requestedActions.clear()
            observedSlotCounts.clear()
            field = value
            value?.let { registerView(this, it) }
            pendingRestoreSide = restoredSide
            restorePending = true
            configurationChanged()
            // Finish registry bookkeeping before a synchronous callback can issue
            // another command; the payload still belongs to the pre-rebind start.
            if (cancelled != null) onGestureCancelled(cancelled)
        }

    private var currentTranslation: Float = 0f
    private var isOpen: Boolean = false
    private var startOffset: Float = 0f
    private var isDragging: Boolean = false
    private var isAnimating: Boolean = false
    private var gestureStartTranslation: Float = 0f
    private var isGestureActivated: Boolean = false
    // Release ends touch activation, not ownership of the eventual completion.
    private var gestureCompletionPending = false
    private var gestureCompletionMetadata: Map<String, Any>? = null
    private var lastEmittedProgress: Float = -1f
    private var lastEmittedWillEndState: String? = null

    private var openSide: SwipeSide? = null
    private var gestureSide: SwipeSide? = null
    private var animationSide: SwipeSide? = null
    private var directGesturePending = false
    private var workGeneration = 0
    // Commands in the same binding execute in order, even as they cancel animations.
    @Volatile private var bindingGeneration = 0L
    private var configurationDirty = false
    private var pendingGestureDisable = false
    private var pendingRestoreSide: SwipeSide? = null
    private var restorePending = false
    private var restoreCacheOnAttach = false
    private val requestedActions = mutableSetOf<SwipeSide>()
    private val observedSlotCounts = mutableMapOf<SwipeSide, Int>()
    private val configurationRunnable = Runnable { applyPendingConfiguration() }

    private val activeSide: SwipeSide?
        get() = gestureSide ?: animationSide ?: openSide ?: defaultOpenSide()

    private var contentView: View? = null
    private var leftActionsView: View? = null
    private var rightActionsView: View? = null
    private val actionsView: View?
        get() = railFor(activeSide)

    private val onSwipeProgress by EventDispatcher<Map<String, Any>>()
    private val onSwipeStart by EventDispatcher<Map<String, Any>>()
    private val onSwipeStateChange by EventDispatcher<Map<String, Any>>()
    private val onSwipeEnd by EventDispatcher<Map<String, Any>>()
    private val onActionsNeeded by EventDispatcher<Map<String, Any>>()
    private val onGestureCancelled by EventDispatcher<Map<String, Any>>()

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var velocityTracker: VelocityTracker? = null
    private var touchStartX: Float = 0f
    private var touchStartY: Float = 0f
    private var isIntercepting: Boolean = false

    // Touch interception for swipe detection
    private var dispatchTouchStartX: Float = 0f
    private var dispatchTouchStartY: Float = 0f
    private var isBlockingChildEvents: Boolean = false
    private var isCurrentTouchCancelled: Boolean = false

    private var contentSpringAnimation: SpringAnimation? = null
    private var actionsSpringAnimation: SpringAnimation? = null

    private var frameCallback: Choreographer.FrameCallback? = null

    // Gesture timeout for stuck gesture recovery
    private var gestureTimeoutRunnable: Runnable? = null

    // Auto-close runnable for tracking and cancellation
    private var autoCloseRunnable: Runnable? = null
    private var autoCloseDeadline: Long? = null
    private var autoCloseClosingSide: SwipeSide? = null

    // Track when a child (e.g. RNGH gesture handler) claims the touch
    private var childRequestedDisallowIntercept: Boolean = false

    // Layout guard: re-applies translations for a few frames after a reorder.
    // Fabric may reset child translationX during prop reconciliation after a
    // recyclingKey change. This guard runs for a bounded number of frames to
    // detect and correct mismatches, then stops automatically.
    private var layoutGuardCallback: Choreographer.FrameCallback? = null
    private var layoutGuardFramesRemaining: Int = 0

    private fun startLayoutGuard(frames: Int = 5) {
        stopLayoutGuard()
        layoutGuardFramesRemaining = frames
        layoutGuardCallback = Choreographer.FrameCallback {
            layoutGuardFramesRemaining--
            if (isOpen && currentTranslation != 0f && !isDragging && !isAnimating) {
                val contentTx = contentView?.translationX ?: 0f
                if (contentTx != currentTranslation) {
                    contentView?.translationX = currentTranslation
                    updateActionsTransform()
                    actionsView?.visibility = View.VISIBLE
                }
            }
            if (layoutGuardFramesRemaining > 0) {
                layoutGuardCallback?.let { Choreographer.getInstance().postFrameCallback(it) }
            } else {
                layoutGuardCallback = null
            }
        }
        layoutGuardCallback?.let { Choreographer.getInstance().postFrameCallback(it) }
    }

    private fun stopLayoutGuard() {
        layoutGuardCallback?.let { Choreographer.getInstance().removeFrameCallback(it) }
        layoutGuardCallback = null
        layoutGuardFramesRemaining = 0
    }

    init {
        clipChildren = false
        clipToPadding = false
        setWillNotDraw(false)
    }

    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        childRequestedDisallowIntercept = disallowIntercept
        super.requestDisallowInterceptTouchEvent(disallowIntercept)
    }

    override fun setClipChildren(clipChildren: Boolean) {
        super.setClipChildren(false)
    }

    override fun setClipToPadding(clipToPadding: Boolean) {
        super.setClipToPadding(false)
    }

    override fun onViewAdded(child: View?) {
        super.onViewAdded(child)
        child ?: return
        reconcileSideChildren()
    }

    override fun onViewRemoved(child: View?) {
        super.onViewRemoved(child)
        if (child === leftActionsView || child === rightActionsView) {
            (child as? ReactViewGroup)?.pointerEvents = PointerEvents.AUTO
        }
        if (child === contentView) {
            contentView = null
            isCurrentTouchCancelled = true
            if (!cancelActiveWork()) return
        }
        reconcileSideChildren()
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        applyPendingConfiguration()
        reconcileSideChildren()
        val width = right - left
        val height = bottom - top

        for (i in 0 until childCount) {
            val child = getChildAt(i)
            // Don't override actionsView layout - Yoga positions it via absoluteFill
            // and lays out children (flex-end) based on full parent width. Overriding
            // the bounds to actionsWidth causes children to be positioned outside the
            // narrower bounds, making them invisible during FlatList reorder.
            // Instead, use translationX to hide/show the actions.
            child.layout(0, 0, width, height)
        }

        updateActionsTransform()

        if (!isDragging && !isAnimating && currentTranslation == 0f && actionsWidthPx > 0f) {
            val actionsOffset = if (isLeading) -actionsWidthPx else actionsWidthPx
            actionsView?.translationX = actionsOffset
        }

        // Re-apply translations when open. Fabric may reset child translationX during
        // prop reconciliation after a list reorder. The post {} ensures we run after
        // Fabric finishes applying all mutations in the current frame.
        if (isOpen && currentTranslation != 0f && !isDragging && !isAnimating) {
            postCurrent {
                if (isOpen && currentTranslation != 0f && !isDragging && !isAnimating) {
                    contentView?.translationX = currentTranslation
                    updateActionsTransform()
                }
            }
        }
    }

    /**
     * Cancels React Native's JS touch handling using the official API.
     * Calls onChildStartedNativeGesture() which properly notifies
     * JSTouchDispatcher and JSPointerDispatcher to cancel tracking.
     */
    private fun cancelReactTouches(event: MotionEvent) {
        NativeGestureUtil.notifyNativeGestureStarted(this, event)
    }

    /**
     * Simple touch interception: forward DOWN, send CANCEL when swipe detected.
     *
     * Flow:
     * - DOWN: Forward to children (they start tracking), init our tracking
     * - MOVE: If horizontal swipe → send CANCEL to children, block further events
     * - UP: If blocking → consume (children never see UP, no onPress)
     */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // Every native touch entry point shares the same cancellation boundary.
        if (suppressCancelledTouch(event)) return true
        if (!gestureEnabled || !hasEnabledSide()) {
            return super.dispatchTouchEvent(event)
        }

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dispatchTouchStartX = event.rawX
                dispatchTouchStartY = event.rawY
                isBlockingChildEvents = false
                childRequestedDisallowIntercept = false

                // Initialize tracking
                touchStartX = event.rawX
                touchStartY = event.rawY
                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain()
                velocityTracker?.addMovement(event)

                // Handle in onTouchEvent for animation interruption
                onTouchEvent(event)

                // Forward DOWN to children
                return super.dispatchTouchEvent(event)
            }

            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)

                // Already blocking - consume all MOVE events
                if (isBlockingChildEvents) {
                    onTouchEvent(event)
                    return true
                }

                val dx = abs(event.rawX - dispatchTouchStartX)
                val dy = abs(event.rawY - dispatchTouchStartY)

                // Detect horizontal swipe
                if (dx > touchSlop && dx > dy) {
                    // If a child gesture handler (e.g. RNGH) claimed the touch, yield to it
                    if (childRequestedDisallowIntercept) {
                        return super.dispatchTouchEvent(event)
                    }

                    val horizontalDelta = event.rawX - dispatchTouchStartX
                    val isCorrectDirection = selectGestureSide(horizontalDelta) != null

                    val meetsOffset = dragOffsetFromEdgePx <= 0f || dx >= dragOffsetFromEdgePx
                    if (isCorrectDirection && meetsOffset && !childRequestedDisallowIntercept) {
                        // Swipe detected - cancel React touches, start blocking
                        isBlockingChildEvents = true
                        cancelReactTouches(event)
                        parent?.requestDisallowInterceptTouchEvent(true)
                        onTouchEvent(event)
                        return true
                    }
                }

                // Not a swipe - forward to children
                return super.dispatchTouchEvent(event)
            }

            MotionEvent.ACTION_UP -> {
                velocityTracker?.addMovement(event)

                if (isBlockingChildEvents) {
                    // Swipe ended - consume UP (children already got CANCEL)
                    onTouchEvent(event)
                    isBlockingChildEvents = false
                    return true
                }

                // Not blocking - forward to children (tap)
                return super.dispatchTouchEvent(event)
            }

            MotionEvent.ACTION_CANCEL -> {
                isBlockingChildEvents = false
                onTouchEvent(event)
                return super.dispatchTouchEvent(event)
            }
        }

        return super.dispatchTouchEvent(event)
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (suppressCancelledTouch(event)) return false
        if (!gestureEnabled || !hasEnabledSide()) return false

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.rawX
                touchStartY = event.rawY
                isIntercepting = false

                if (isAnimating || gestureCompletionPending) {
                    interruptAnimation()
                }

                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain()
                velocityTracker?.addMovement(event)
            }
            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                val horizontalDelta = event.rawX - touchStartX
                val verticalDelta = event.rawY - touchStartY

                if (abs(horizontalDelta) > touchSlop && abs(horizontalDelta) > abs(verticalDelta)) {
                    val isCorrectDirection = selectGestureSide(horizontalDelta) != null
                    val meetsOffset = dragOffsetFromEdgePx <= 0f || abs(horizontalDelta) >= dragOffsetFromEdgePx

                    if (isCorrectDirection && meetsOffset && !childRequestedDisallowIntercept) {
                        isIntercepting = true
                        parent?.requestDisallowInterceptTouchEvent(true)
                        return true
                    }
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                isIntercepting = false
                parent?.requestDisallowInterceptTouchEvent(false)
            }
        }
        return false
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (suppressCancelledTouch(event)) return true
        if (!gestureEnabled || !hasEnabledSide()) return false

        velocityTracker?.addMovement(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.rawX
                touchStartY = event.rawY
                if (isAnimating || gestureCompletionPending) interruptAnimation()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val horizontalDelta = event.rawX - touchStartX

                if (!isGestureActivated) {
                    val meetsOffset = dragOffsetFromEdgePx <= 0f || abs(horizontalDelta) >= dragOffsetFromEdgePx
                    val meetsActivation = (abs(horizontalDelta) > touchSlop && abs(horizontalDelta) > abs(event.rawY - touchStartY))
                    if (meetsOffset && meetsActivation) {
                        activateGesture(horizontalDelta)
                    } else {
                        return true
                    }
                }

                handlePanUpdate(horizontalDelta)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (isGestureActivated) {
                    velocityTracker?.computeCurrentVelocity(1000)
                    val horizontalDelta = event.rawX - touchStartX
                    if (event.actionMasked == MotionEvent.ACTION_CANCEL) {
                        isCurrentTouchCancelled = true
                        reconcileLogicalState()
                    } else {
                        handlePanEnd(horizontalDelta, velocityTracker?.xVelocity ?: 0f)
                    }
                }
                velocityTracker?.recycle()
                velocityTracker = null
                isIntercepting = false
            }
        }
        return isGestureActivated || isIntercepting
    }

    private fun activateGesture(initialTranslation: Float) {
        if (isCurrentTouchCancelled) return
        applyPendingConfiguration()
        if (isCurrentTouchCancelled) return
        val side = selectGestureSide(initialTranslation) ?: return
        val blockingChildren = isBlockingChildEvents
        val intercepting = isIntercepting
        if (!cancelActiveWork()) return
        isBlockingChildEvents = blockingChildren
        isIntercepting = intercepting
        gestureSide = side
        animationSide = null
        isGestureActivated = true
        isDragging = true
        startOffset = currentTranslation
        gestureStartTranslation = initialTranslation
        lastEmittedWillEndState = if (isOpen) "open" else "closed"
        val generation = workGeneration
        actionsView?.visibility = View.VISIBLE
        requestActions(side, retryEmptySlot = true)
        if (generation != workGeneration || !isGestureActivated) return
        refreshRailVisibility()
        parent?.requestDisallowInterceptTouchEvent(true)
        gestureCompletionPending = true
        gestureCompletionMetadata = sideMetadata(side)
        onSwipeStart(gestureCompletionMetadata!!)
        if (generation != workGeneration || !isGestureActivated) return
        startProgressUpdates()
        startGestureTimeout()
    }

    private fun startGestureTimeout() {
        cancelGestureTimeout()
        val generation = workGeneration
        gestureTimeoutRunnable = Runnable {
            if (generation == workGeneration && isGestureActivated) {
                // Force gesture end if stuck
                handlePanEnd(0f, 0f)
            }
        }
        postDelayed(gestureTimeoutRunnable, GESTURE_TIMEOUT_MS)
    }

    private fun cancelGestureTimeout() {
        gestureTimeoutRunnable?.let { removeCallbacks(it) }
        gestureTimeoutRunnable = null
    }

    private fun cancelAutoClose() {
        autoCloseRunnable?.let { removeCallbacks(it) }
        autoCloseRunnable = null
        autoCloseDeadline = null
    }

    private fun scheduleAutoClose(deadline: Long = SystemClock.uptimeMillis() + maxOf(0L, autoCloseTimeout.toLong())) {
        cancelAutoClose()
        autoCloseDeadline = deadline
        val generation = workGeneration
        val key = recyclingKey
        val side = openSide
        autoCloseRunnable = Runnable {
            autoCloseRunnable = null
            autoCloseDeadline = null
            if (generation == workGeneration && key == recyclingKey && isOpen && openSide == side && autoClose) {
                closeInternal(animated = true, autoCloseCompletion = true)
            }
        }
        postDelayed(autoCloseRunnable, maxOf(0L, deadline - SystemClock.uptimeMillis()))
    }

    private fun handlePanUpdate(translationX: Float) {
        if (!isGestureActivated || actionsWidthPx <= 0f) return

        val effectiveTranslation = translationX - gestureStartTranslation

        val targetTranslation = SwipePhysics.applyLatchedTranslation(
            startOffset, effectiveTranslation, friction, actionsWidthPx, gestureSide ?: return
        )

        currentTranslation = targetTranslation
        contentView?.translationX = targetTranslation
        updateActionsTransform()

        // Emit onSwipeStateChange when threshold crossing changes intended state
        val thresholdDistance = actionsWidthPx * threshold
        val decisionTranslation = effectiveTranslation * friction
        val wouldOpen = SwipePhysics.shouldSnapToOpen(decisionTranslation, thresholdDistance, isOpen, isLeading)
        val intendedState = if (wouldOpen) "open" else "closed"
        if (lastEmittedWillEndState != intendedState) {
            lastEmittedWillEndState = intendedState
            onSwipeStateChange(stateEvent(intendedState))
        }
    }

    private fun handlePanEnd(translationX: Float, velocityX: Float) {
        if (!isGestureActivated) return

        val generation = workGeneration
        val effectiveTranslation = translationX - gestureStartTranslation

        isGestureActivated = false
        gestureStartTranslation = 0f
        isDragging = false
        stopProgressUpdates()
        cancelGestureTimeout()

        val projectedX = SwipePhysics.projectFinalPosition(effectiveTranslation, velocityX, friction)
        val thresholdDistance = actionsWidthPx * threshold
        val shouldOpen = SwipePhysics.shouldSnapToOpen(projectedX, thresholdDistance, isOpen, isLeading)

        // Only emit onSwipeStateChange if state changed from what was emitted during drag
        // (velocity projection may result in different final state)
        val intendedState = if (shouldOpen) "open" else "closed"
        if (lastEmittedWillEndState != intendedState) {
            lastEmittedWillEndState = intendedState
            onSwipeStateChange(stateEvent(intendedState))
        }

        if (generation != workGeneration || isCurrentTouchCancelled) return
        if (shouldOpen) {
            // Only use velocity if it's in the opening direction (prevents backward bounce)
            val openingVelocity = if (isLeading) {
                if (velocityX > 0) velocityX else 0f  // Leading: positive velocity opens
            } else {
                if (velocityX < 0) velocityX else 0f  // Trailing: negative velocity opens
            }
            // A release settles its latch; an argumentless command uses the configured default.
            openInternal(gestureSide ?: return, openingVelocity, preserveGestureCompletion = true)
            // Schedule auto-close if enabled
            if (autoClose && isOpen && !isCurrentTouchCancelled) {
                scheduleAutoClose()
            }
        } else {
            // Only use velocity if it's in the closing direction (prevents backward bounce)
            val closingVelocity = if (isLeading) {
                if (velocityX < 0) velocityX else 0f  // Leading: negative velocity closes
            } else {
                if (velocityX > 0) velocityX else 0f  // Trailing: positive velocity closes
            }
            applyPendingConfiguration()
            closeInternal(animated = true, velocity = closingVelocity, preserveGestureCompletion = true)
        }
    }

    private fun updateActionsTransform() {
        for (side in SwipeSide.values()) {
            val rail = railFor(side) ?: continue
            val width = widthFor(side)
            val progress = if (side == activeSide && width > 0f) minOf(abs(currentTranslation) / width, 1f) else 0f
            rail.translationX = -side.sign * width * (1f - progress)
        }
        refreshRailVisibility()
    }

    fun open(velocity: Float = 0f) {
        applyPendingConfiguration()
        val side = defaultOpenSide() ?: return
        open(side, velocity)
    }

    fun open(side: SwipeSide, velocity: Float = 0f) {
        openInternal(side, velocity)
    }

    private fun openInternal(side: SwipeSide, velocity: Float, preserveGestureCompletion: Boolean = false) {
        applyPendingConfiguration()
        if (!isSideEnabled(side)) return
        if (!preserveGestureCompletion && (isGestureActivated || directGesturePending)) {
            isCurrentTouchCancelled = true
        }
        val previousSide = gestureSide ?: animationSide ?: openSide
        if (previousSide != null && previousSide != side &&
            (isOpen || currentTranslation != 0f || isAnimating || gestureCompletionPending)) {
            closeInternal(animated = true, afterClose = { open(side, velocity) })
            return
        }
        // An ordinary open can deliver the pending end. An imperative auto-close
        // open neither schedules a timer nor emits an end, so it abandons ownership.
        if (!cancelActiveWork(preserveGestureCompletion || !autoClose)) return
        animationSide = side
        openSide = side
        val generation = workGeneration
        requestActions(side, retryEmptySlot = true)
        if (generation != workGeneration) return
        isOpen = true
        isAnimating = true
        // Thread-safe persist to static cache for FlashList recycling
        persistOpenSide(side)
        // Note: actionsView visibility is already set during drag phase
        if (actionsView?.visibility != View.VISIBLE) {
            actionsView?.visibility = View.VISIBLE
        }
        val targetX = if (isLeading) actionsWidthPx else -actionsWidthPx

        val springVelocity = SwipePhysics.calculateSpringVelocity(velocity)

        // Start progress updates to emit progress during animation
        startProgressUpdates()

        val content = contentView

        if (content == null) {
            currentTranslation = targetX
            isAnimating = false
            emitFinalProgress(1f, targetX)
            if (generation != workGeneration) return
            if (!autoClose) emitSwipeEnd("open", side)
            if (generation != workGeneration) return
            refreshRailVisibility()
            return
        }

        // Define bounds and clamp starting position to prevent IllegalArgumentException
        val minBound = if (isLeading) 0f else -actionsWidthPx
        val maxBound = if (isLeading) actionsWidthPx else 0f

        // Clamp content's current position to within bounds before starting animation
        // (user may have overswept beyond the target)
        val clampedStart = content.translationX.coerceIn(minBound, maxBound)
        val wasClamped = content.translationX != clampedStart
        if (wasClamped) {
            content.translationX = clampedStart
            currentTranslation = clampedStart
        }

        // If we clamped to the target, use zero velocity to prevent spring bounce
        val effectiveVelocity = if (wasClamped && clampedStart == targetX) 0f else springVelocity

        contentSpringAnimation = SpringAnimation(content, DynamicAnimation.TRANSLATION_X, targetX).apply {
            spring = SpringForce(targetX).apply {
                stiffness = SwipeConstants.OPEN_STIFFNESS
                dampingRatio = SwipeConstants.OPEN_DAMPING_RATIO
            }
            // Clamp animation bounds to prevent spring overshoot from affecting UI
            setMinValue(minBound)
            setMaxValue(maxBound)
            setStartVelocity(effectiveVelocity)
            addUpdateListener { _, value, _ ->
                if (generation != workGeneration) return@addUpdateListener
                currentTranslation = value
                updateActionsTransform()
            }
            addEndListener { _, canceled, _, _ ->
                if (canceled || generation != workGeneration) return@addEndListener
                isAnimating = false
                startLayoutGuard()
                emitFinalProgress(1f, targetX)
                if (generation != workGeneration) return@addEndListener
                // With autoClose, let close() emit onSwipeEnd("open") instead
                if (!autoClose) {
                    emitSwipeEnd("open", side)
                }
            }
            start()
        }
        // Actions are now driven by updateActionsTransform() called from content's update listener
    }

    /** Snaps to the current edge, or the canonical default enabled edge. */
    fun snapToOpen() {
        applyPendingConfiguration()
        val side = openSide ?: defaultOpenSide() ?: return
        snapToOpen(side)
    }

    private fun snapToOpen(side: SwipeSide) {
        if (!isSideEnabled(side)) return
        if (isGestureActivated || directGesturePending) isCurrentTouchCancelled = true
        if (!cancelActiveWork()) return
        isOpen = true
        openSide = side
        animationSide = side
        currentTranslation = side.sign * widthFor(side)
        contentView?.translationX = currentTranslation
        val generation = workGeneration
        requestActions(side, retryEmptySlot = true)
        if (generation != workGeneration) return
        if (actionsView != null) {
            actionsView?.visibility = View.VISIBLE
            actionsView?.translationX = 0f
        }
        if (generation != workGeneration) return
        updateActionsTransform()
        startLayoutGuard()
        emitFinalProgress(1f, currentTranslation)
    }

    fun close(animated: Boolean = true, velocity: Float = 0f) {
        applyPendingConfiguration()
        closeInternal(animated, velocity)
    }

    private fun closeInternal(
        animated: Boolean,
        velocity: Float = 0f,
        autoCloseCompletion: Boolean = false,
        preserveGestureCompletion: Boolean = false,
        afterClose: (() -> Unit)? = null
    ) {
        val side = activeSide ?: SwipeSide.RIGHT
        val width = widthFor(side)
        if (isGestureActivated || directGesturePending) {
            isCurrentTouchCancelled = true
        }
        // An animated close takes over the pending gesture's eventual end.
        // Keep ownership until that end or a later silent interruption.
        if (!cancelActiveWork(animated || preserveGestureCompletion || autoCloseCompletion)) return
        val generation = workGeneration
        animationSide = side
        autoCloseClosingSide = if (autoCloseCompletion) side else null
        isOpen = false
        openSide = null
        restorePending = false
        pendingRestoreSide = null
        persistOpenSide(null)

        if (!animated) {
            animationSide = null
            resetPosition()
            return
        }
        isAnimating = true
        startProgressUpdates()
        val content = contentView
        if (content == null) {
            currentTranslation = 0f
            actionsView?.translationX = -side.sign * width
            isAnimating = false
            emitFinalProgress(0f, 0f)
            if (generation != workGeneration) return
            autoCloseClosingSide = null
            emitSwipeEnd(if (autoCloseCompletion) "open" else "closed", side)
            if (generation != workGeneration) return
            animationSide = null
            refreshRailVisibility()
            if (generation == workGeneration) afterClose?.invoke()
            return
        }

        val minBound = if (side == SwipeSide.LEFT) 0f else -width
        val maxBound = if (side == SwipeSide.LEFT) width else 0f
        val clampedStart = content.translationX.coerceIn(minBound, maxBound)
        val wasClamped = content.translationX != clampedStart
        if (wasClamped) {
            content.translationX = clampedStart
            currentTranslation = clampedStart
        }
        val springVelocity = SwipePhysics.calculateSpringVelocity(velocity)
        val effectiveVelocity = if (wasClamped && clampedStart == 0f) 0f else springVelocity
        contentSpringAnimation = SpringAnimation(content, DynamicAnimation.TRANSLATION_X, 0f).apply {
            spring = SpringForce(0f).apply {
                stiffness = SwipeConstants.CLOSE_STIFFNESS
                dampingRatio = SwipeConstants.CLOSE_DAMPING_RATIO
            }
            setMinValue(minBound)
            setMaxValue(maxBound)
            setStartVelocity(effectiveVelocity)
            addUpdateListener { _, value, _ ->
                if (generation != workGeneration) return@addUpdateListener
                currentTranslation = value
                updateActionsTransform()
            }
            addEndListener { _, canceled, _, _ ->
                if (canceled || generation != workGeneration) return@addEndListener
                isAnimating = false
                currentTranslation = 0f
                actionsView?.visibility = View.INVISIBLE
                emitFinalProgress(0f, 0f)
                if (generation != workGeneration) return@addEndListener
                autoCloseClosingSide = null
                emitSwipeEnd(if (autoCloseCompletion) "open" else "closed", side)
                if (generation != workGeneration) return@addEndListener
                animationSide = null
                refreshRailVisibility()
                if (generation == workGeneration) afterClose?.invoke()
            }
            start()
        }
    }

    fun handleGestureStart() {
        applyPendingConfiguration()
        if (!gestureEnabled || !hasEnabledSide()) return
        // The direct API start is the equivalent of a fresh ACTION_DOWN.
        isCurrentTouchCancelled = false
        if (!cancelActiveWork()) return
        directGesturePending = true
    }

    fun handleGestureUpdate(translationX: Float, velocityX: Float) {
        if (isCurrentTouchCancelled) return
        if (directGesturePending && abs(translationX) > touchSlop && abs(translationX) >= dragOffsetFromEdgePx) {
            activateGesture(translationX)
            if (isGestureActivated) gestureStartTranslation = 0f
        }
        handlePanUpdate(translationX)
    }

    fun handleGestureEnd(translationX: Float, velocityX: Float) {
        if (isCurrentTouchCancelled) return
        directGesturePending = false
        handlePanEnd(translationX, velocityX)
    }

    private fun startProgressUpdates() {
        if (frameCallback != null) return

        frameCallback = Choreographer.FrameCallback {
            emitProgressIfChanged()
            if (isDragging || isAnimating) {
                frameCallback?.let { Choreographer.getInstance().postFrameCallback(it) }
            } else {
                // Callback stopped naturally - clear reference so startProgressUpdates() can restart it
                frameCallback = null
            }
        }
        frameCallback?.let { Choreographer.getInstance().postFrameCallback(it) }
    }

    private fun stopProgressUpdates() {
        frameCallback?.let {
            Choreographer.getInstance().removeFrameCallback(it)
        }
        frameCallback = null
        lastEmittedProgress = -1f
    }

    private fun emitProgressIfChanged() {
        if (actionsWidthPx <= 0f) return

        // During animation, read from view's actual translationX to get real animated value
        // (SpringAnimation updates view.translationX directly, but currentTranslation may lag
        // due to Choreographer callback ordering - our callback may run before SpringAnimation's)
        val translation = if (isAnimating) {
            contentView?.translationX ?: currentTranslation
        } else {
            currentTranslation
        }

        val progress = (abs(translation) / actionsWidthPx).coerceIn(0f, 1f)

        if (abs(progress - lastEmittedProgress) > SwipeConstants.PROGRESS_CHANGE_THRESHOLD) {
            lastEmittedProgress = progress
            onSwipeProgress(mapOf(
                "progress" to progress.toDouble(),
                "translationX" to translation.toDouble()
            ) + sideMetadata())
        }
    }

    private fun emitFinalProgress(progress: Float, translationX: Float) {
        lastEmittedProgress = progress
        // Use fresh map for each emission
        onSwipeProgress(mapOf(
            "progress" to progress.toDouble(),
            "translationX" to translationX.toDouble()
        ) + sideMetadata())
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        recyclingKey?.let { registerView(this, it) }
        if (restoreCacheOnAttach) {
            restoreCacheOnAttach = false
            recyclingKey?.let { key ->
                // Detached commands can change cached intent without a registered
                // view. The same instance must restore that intent too.
                pendingRestoreSide = openStateCache[key]
                restorePending = true
                isOpen = false
                openSide = null
                animationSide = null
                configurationChanged()
            }
        }
        applyPendingConfiguration()
        reconcileSideChildren()
        if (isOpen) openSide?.let(::requestActions)
        if (isOpen && currentTranslation != 0f) {
            postCurrent {
                if (isOpen && currentTranslation != 0f && !isDragging && !isAnimating) {
                    contentView?.translationX = currentTranslation
                    updateActionsTransform()
                    actionsView?.visibility = View.VISIBLE
                }
            }
        }
    }

    override fun onDetachedFromWindow() {
        val cancelled = takeGestureCancellation()
        bindingGeneration++
        restoreCacheOnAttach = true
        isCurrentTouchCancelled = true
        super.onDetachedFromWindow()
        removeCallbacks(configurationRunnable)
        velocityTracker?.recycle()
        velocityTracker = null
        requestedActions.clear()
        observedSlotCounts.clear()
        recyclingKey?.let { unregisterView(this, it) }
        cancelActiveWork()
        reconcileLogicalState(restartLayoutGuard = false)
        if (cancelled != null) onGestureCancelled(cancelled)
    }

    private fun validWidth(value: Float): Float = if (value.isFinite() && value > 0f) value else 0f

    private fun widthFor(side: SwipeSide): Float =
        if (side == SwipeSide.LEFT) leftWidthPx else rightWidthPx

    private fun isSideEnabled(side: SwipeSide): Boolean = widthFor(side) > 0f

    private fun hasEnabledSide(): Boolean = leftWidthPx > 0f || rightWidthPx > 0f

    private fun defaultOpenSide(): SwipeSide? =
        SwipePhysics.defaultOpenSide(leftWidthPx, rightWidthPx)

    private fun selectGestureSide(translation: Float): SwipeSide? = SwipePhysics.selectSide(
        translation, openSide ?: animationSide, gestureSide, leftWidthPx, rightWidthPx
    )

    private fun railFor(side: SwipeSide?): View? = when (side) {
        SwipeSide.LEFT -> leftActionsView
        SwipeSide.RIGHT -> rightActionsView
        null -> null
    }

    private fun sideMetadata(side: SwipeSide? = activeSide): Map<String, Any> {
        if (side == null) return emptyMap()
        val key = recyclingKey
        return if (key != null) mapOf("side" to side.value, "recyclingKey" to key)
            else mapOf("side" to side.value)
    }

    private fun stateEvent(state: String, side: SwipeSide? = activeSide): Map<String, Any> =
        mapOf("state" to state) + sideMetadata(side)

    private fun emitSwipeEnd(state: String, side: SwipeSide) {
        gestureCompletionPending = false
        gestureCompletionMetadata = null
        onSwipeEnd(stateEvent(state, side))
    }

    private fun requestActions(side: SwipeSide, retryEmptySlot: Boolean = false) {
        // A slot may be emptied without changing this view's own layout bounds.
        if (retryEmptySlot && (railFor(side) as? ViewGroup)?.childCount == 0) {
            requestedActions.remove(side)
        }
        if (isSideEnabled(side) && requestedActions.add(side)) {
            onActionsNeeded(mapOf("side" to side.value) + sideMetadata(side))
        }
    }

    private fun configurationChanged() {
        // Invalidates callbacks immediately, but commits related widths/key together.
        workGeneration++
        configurationDirty = true
        removeCallbacks(configurationRunnable)
        post(configurationRunnable)
        requestLayout()
    }

    internal fun applyPendingConfiguration() {
        if (!configurationDirty) return
        configurationDirty = false
        removeCallbacks(configurationRunnable)
        if (isGestureActivated || directGesturePending) {
            // Configuration changes consume the remainder of this physical/direct gesture.
            isCurrentTouchCancelled = true
        }
        reconcileSideChildren()
        if (pendingGestureDisable && !gestureEnabled) {
            if (!cancelActiveWork()) return
            isOpen = false
            openSide = null
            animationSide = null
            pendingRestoreSide = null
            resetPosition()
            persistOpenSide(null)
        }
        pendingGestureDisable = false
        if (restorePending) {
            val restored = pendingRestoreSide
            restorePending = false
            pendingRestoreSide = null
            if (restored != null && isSideEnabled(restored)) {
                snapToOpen(restored)
            } else {
                persistOpenSide(null)
                reconcileLogicalState()
            }
        } else {
            reconcileLogicalState()
        }
    }

    private fun reconcileLogicalState(restartLayoutGuard: Boolean = true) {
        val side = openSide
        val deadline = autoCloseDeadline
        val closingSide = autoCloseClosingSide
        val resumesCompletion = autoClose && (
            closingSide != null && isSideEnabled(closingSide) ||
                isOpen && side != null && isSideEnabled(side) && deadline != null
            )
        if (!cancelActiveWork(preserveGestureCompletion = resumesCompletion)) return
        animationSide = null
        if (autoClose && closingSide != null && isSideEnabled(closingSide)) {
            // Continue an actual auto-close animation, preserving its original side/intent.
            animationSide = closingSide
            closeInternal(animated = true, autoCloseCompletion = true)
            return
        }
        if (isOpen && side != null && isSideEnabled(side)) {
            openSide = side
            currentTranslation = openSide!!.sign * widthFor(openSide!!)
            contentView?.translationX = currentTranslation
            updateActionsTransform()
            if (restartLayoutGuard) startLayoutGuard()
        } else {
            isOpen = false
            openSide = null
            resetPosition()
        }
        persistOpenSide(openSide)
        if (autoClose && isOpen && deadline != null) scheduleAutoClose(deadline)
    }

    private fun persistOpenSide(side: SwipeSide?) {
        recyclingKey?.let { key ->
            if (getView(key) === this) setOpenState(key, side)
        }
    }

    private fun resetPosition() {
        currentTranslation = 0f
        startOffset = 0f
        contentView?.translationX = 0f
        updateActionsTransform()
    }

    private fun takeGestureCancellation(): Map<String, Any>? {
        val cancelled = if (gestureCompletionPending) gestureCompletionMetadata else null
        gestureCompletionPending = false
        gestureCompletionMetadata = null
        return cancelled
    }

    private fun cancelActiveWork(preserveGestureCompletion: Boolean = false): Boolean {
        // Capture the original start's identity before any reset/rebind. Dispatch
        // after clearing ownership, but before the caller can emit a replacement start.
        val cancelled = if (!preserveGestureCompletion) takeGestureCancellation() else null
        workGeneration++
        val generation = workGeneration
        currentTranslation = contentView?.translationX ?: currentTranslation
        contentSpringAnimation?.cancel()
        contentSpringAnimation = null
        actionsSpringAnimation?.cancel()
        actionsSpringAnimation = null
        cancelAutoClose()
        autoCloseClosingSide = null
        cancelGestureTimeout()
        stopProgressUpdates()
        stopLayoutGuard()
        isAnimating = false
        isDragging = false
        isGestureActivated = false
        directGesturePending = false
        gestureSide = null
        gestureStartTranslation = 0f
        lastEmittedWillEndState = null
        isBlockingChildEvents = false
        isIntercepting = false
        childRequestedDisallowIntercept = false
        parent?.requestDisallowInterceptTouchEvent(false)
        if (cancelled != null) onGestureCancelled(cancelled)
        // Event dispatch is normally asynchronous, but native callbacks can reenter.
        // In that case the newer work owns the view and the caller must stop.
        return generation == workGeneration
    }

    private fun interruptAnimation() {
        val side = activeSide
        if (!cancelActiveWork()) return
        animationSide = side
    }

    private fun postCurrent(action: () -> Unit) {
        val generation = workGeneration
        val key = recyclingKey
        post { if (generation == workGeneration && key == recyclingKey) action() }
    }

    internal fun postCommand(action: () -> Unit) {
        val generation = bindingGeneration
        val key = recyclingKey
        post {
            if (generation == bindingGeneration && key == recyclingKey &&
                (key == null || getView(key) === this)) {
                action()
            }
        }
    }

    private fun reconcileSideChildren() {
        val previousContent = contentView
        val previousLeft = leftActionsView
        val previousRight = rightActionsView
        if (childCount == 3) {
            leftActionsView = getChildAt(0)
            rightActionsView = getChildAt(1)
            contentView = getChildAt(2)
        } else {
            // Retain only known identities. A rail must never become content mid-transaction.
            if (contentView?.parent !== this) contentView = null
            if (leftActionsView?.parent !== this) leftActionsView = null
            if (rightActionsView?.parent !== this) rightActionsView = null
        }
        for (side in SwipeSide.values()) {
            val rail = railFor(side)
            val previous = if (side == SwipeSide.LEFT) previousLeft else previousRight
            val count = (rail as? ViewGroup)?.childCount ?: 0
            if (rail !== previous || (observedSlotCounts[side] ?: 0) > 0 && count == 0) requestedActions.remove(side)
            observedSlotCounts[side] = count
            (rail as? ViewGroup)?.apply {
                clipChildren = false
                clipToPadding = false
            }
        }
        if (contentView !== previousContent) contentView?.translationX = currentTranslation
        if (isOpen || isDragging || isAnimating) activeSide?.let(::requestActions)
        updateActionsTransform()
    }

    private fun refreshRailVisibility() {
        for (side in SwipeSide.values()) {
            val visible = childCount == 3 && isSideEnabled(side) && side == activeSide &&
                (isOpen || isDragging || isAnimating) && (currentTranslation != 0f || isOpen)
            railFor(side)?.apply {
                visibility = if (visible) View.VISIBLE else View.INVISIBLE
                // RN's TouchTargetHelper ignores Android visibility. An empty
                // zero-width rail still spans the row and otherwise steals taps
                // from the exposed opposite action, even with no descendants.
                (this as? ReactViewGroup)?.pointerEvents = if (visible) PointerEvents.AUTO else PointerEvents.NONE
                importantForAccessibility = if (visible) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                    else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            }
        }
    }

}
