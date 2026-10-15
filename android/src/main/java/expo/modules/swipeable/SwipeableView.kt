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

        // Keep the legacy command signatures unchanged.
        fun openByKey(key: String) = postCommand(key) { it.open() }

        fun openByKeyOnSide(key: String, side: SwipeSide?) {
            if (side != null) postCommand(key) { it.open(side) }
        }

        fun getOpenSideByKey(key: String): String? = openStateCache[key]?.value

        fun closeByKey(key: String, animated: Boolean = true) = postCommand(key) { it.close(animated) }

        fun cancelByKey(key: String) = postCommand(key) { it.cancelGesture() }

        /** Animated closes target open rows; instant resets retain the legacy cache policy. */
        fun closeAll(animated: Boolean = true) {
            getAllViews().forEach { view ->
                val activeTwoSided = view.twoSided && (view.isAnimating || view.isDragging ||
                    view.directGesturePending || view.restorePending)
                if (!animated || view.isOpen || activeTwoSided) {
                    view.recyclingKey?.let { key -> postCommand(key) { it.close(animated) } }
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

    var actionsWidth: Float = 0f
        set(value) {
            val validated = maxOf(0f, value)
            val previous = field
            if (previous == validated) return
            field = validated
            if (shouldSyncOpenLayoutForPropChange(previous, validated)) {
                syncOpenStateToCurrentWidth()
            }
            requestLayout()
        }

    private val actionsWidthPx: Float
        get() = if (twoSided) activeSide?.let(::widthFor) ?: 0f else actionsWidth * density

    var twoSided: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            configurationChanged()
        }

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

    var actionsPosition: String = "right"
        set(value) {
            val validated = if (value == "left" || value == "right") value else "right"
            if (field == validated) return
            field = validated
            if (twoSided) configurationChanged()
            requestLayout()
        }

    val isLeading: Boolean get() = if (twoSided) activeSide == SwipeSide.LEFT else actionsPosition == "left"

    var friction: Float = 1.0f
        set(value) { field = value.coerceIn(0f, 1f) }

    var threshold: Float = 0.4f
        set(value) { field = value.coerceIn(0f, 1f) }

    var gestureEnabled: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            if (twoSided) {
                pendingGestureDisable = !value
                configurationChanged()
                return
            }

            if (!value) {
                abortActiveGesture()
                if (isOpen || currentTranslation != 0f) {
                    close(animated = false)
                }
            }
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

    private fun abortActiveGesture() {
        isBlockingChildEvents = false
        isIntercepting = false

        if (isDragging || isGestureActivated) {
            isDragging = false
            isGestureActivated = false
            gestureStartTranslation = 0f
            cancelGestureTimeout()
            stopProgressUpdates()
            velocityTracker?.recycle()
            velocityTracker = null
        }
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
            bindingGeneration++
            val restoredSide = value?.let { openStateCache[it] }
            if (oldValue != null) {
                if (getView(oldValue) === this) {
                    setOpenState(oldValue, if (isOpen) openSide ?: legacySide else null)
                }
                unregisterView(this, oldValue)
            }
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
            recycleSnapPending = restoredSide != null
            configurationChanged()
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
    private var lastEmittedProgress: Float = -1f
    private var pendingShouldOpen: Boolean = false
    /** Tracks pending snapToOpen from recyclingKey setter. Unlike pendingShouldOpen,
     *  this survives close(animated:false) so onViewAdded can position actions correctly. */
    private var recycleSnapPending: Boolean = false
    private var lastEmittedWillEndState: String? = null

    private var openSide: SwipeSide? = null
    private var gestureSide: SwipeSide? = null
    private var animationSide: SwipeSide? = null
    private var directGesturePending = false
    private var workGeneration = 0
    // Commands in the same binding execute in order, even as they cancel animations.
    @Volatile private var bindingGeneration = 0L
    private var configurationDirty = false
    private var appliedTwoSided = false
    private var legacyRolesPending = false
    private var pendingGestureDisable = false
    private var pendingRestoreSide: SwipeSide? = null
    private var restorePending = false
    private val requestedActions = mutableSetOf<SwipeSide>()
    private val observedSlotCounts = mutableMapOf<SwipeSide, Int>()
    private val configurationRunnable = Runnable { applyPendingConfiguration() }

    private val legacySide: SwipeSide
        get() = if (actionsPosition == "left") SwipeSide.LEFT else SwipeSide.RIGHT

    private val activeSide: SwipeSide?
        get() = if (!twoSided) legacySide else gestureSide ?: animationSide ?: openSide ?: defaultOpenSide()

    private var contentView: View? = null
    private var legacyActionsView: View? = null
    private var leftActionsView: View? = null
    private var rightActionsView: View? = null
    private var actionsView: View?
        get() = if (twoSided) railFor(activeSide) else legacyActionsView
        set(value) { legacyActionsView = value }

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
        if (twoSided) {
            reconcileSideChildren()
            return
        }
        if (legacyRolesPending) {
            postCurrent { completeLegacyChildTransition() }
            return
        }

        val wasActionsNil = actionsView == null
        val wasContentNil = contentView == null

        // With lazy Actions rendering:
        // - When Actions not mounted: only content at index 0
        // - When Actions mounted: actions at index 0, content at index 1
        // Always re-evaluate all children since React may add them in any order
        if (childCount == 1) {
            // Only one child - it's content (Actions not mounted yet)
            contentView = getChildAt(0)
            actionsView = null
        } else if (childCount >= 2) {
            // Always check both positions - React may have reordered children
            actionsView = getChildAt(0)
            contentView = getChildAt(1)
        }

        if (wasContentNil && contentView != null && (isOpen || currentTranslation != 0f)) {
            contentView?.translationX = currentTranslation
        }

        if (wasActionsNil && actionsView != null) {
            // Prevent child clipping: Yoga lays out children for absoluteFill (full parent width)
            // but our onLayout overrides the actionsView bounds to actionsWidth. Without this,
            // children positioned by Yoga's flex-end would be clipped beyond the narrower bounds.
            (actionsView as? ViewGroup)?.clipChildren = false
            (actionsView as? ViewGroup)?.clipToPadding = false

            if (isOpen || isAnimating) {
                actionsView?.visibility = View.VISIBLE
                actionsView?.translationX = 0f
            }
            else if (isDragging) {
                actionsView?.visibility = View.VISIBLE
                updateActionsTransform()
            }
            else if (pendingShouldOpen) {
                pendingShouldOpen = false
                postCurrent { snapToOpen() }
            }
            else if (recycleSnapPending) {
                // Actions were rendered by React (via isOpenByKey) before native snapToOpen ran.
                // Position them immediately so they're visible when UIAutomator checks.
                recycleSnapPending = false
                actionsView?.visibility = View.VISIBLE
                actionsView?.translationX = 0f
            }
        }
    }

    override fun onViewRemoved(child: View?) {
        super.onViewRemoved(child)
        if (twoSided) {
            if (child === leftActionsView || child === rightActionsView) {
                (child as? ReactViewGroup)?.pointerEvents = PointerEvents.AUTO
            }
            if (child === contentView) cancelActiveWork()
            reconcileSideChildren()
            return
        }
        if (legacyRolesPending) {
            postCurrent { completeLegacyChildTransition() }
            return
        }
        if (child === actionsView) {
            actionsView = null
        } else if (child === contentView) {
            contentView = null
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        applyPendingConfiguration()
        if (twoSided) reconcileSideChildren() else if (legacyRolesPending) completeLegacyChildTransition()
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

        if (twoSided) updateActionsTransform()

        if (!isDragging && !isAnimating && currentTranslation == 0f && actionsWidthPx > 0f && !recycleSnapPending) {
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
                    val isCorrectDirection = if (twoSided) {
                        selectGestureSide(horizontalDelta) != null
                    } else if (isOpen) {
                        true
                    } else {
                        if (isLeading) horizontalDelta > 0 else horizontalDelta < 0
                    }

                    val meetsOffset = !twoSided || dragOffsetFromEdgePx <= 0f || dx >= dragOffsetFromEdgePx
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

                if (isAnimating) {
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
                    val isCorrectDirection = if (twoSided) {
                        selectGestureSide(horizontalDelta) != null
                    } else if (isOpen) {
                        true
                    } else {
                        if (isLeading) horizontalDelta > 0 else horizontalDelta < 0
                    }
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
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val horizontalDelta = event.rawX - touchStartX

                if (!isGestureActivated) {
                    val meetsOffset = dragOffsetFromEdgePx <= 0f || abs(horizontalDelta) >= dragOffsetFromEdgePx
                    val meetsActivation = !twoSided || (abs(horizontalDelta) > touchSlop && abs(horizontalDelta) > abs(event.rawY - touchStartY))
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
                    if (twoSided && event.actionMasked == MotionEvent.ACTION_CANCEL) {
                        val cancelled = sideMetadata()
                        isCurrentTouchCancelled = true
                        reconcileLogicalState()
                        onGestureCancelled(cancelled)
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
        val side = if (twoSided) selectGestureSide(initialTranslation) ?: return else legacySide
        val blockingChildren = isBlockingChildEvents
        val intercepting = isIntercepting
        cancelActiveWork()
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
        gestureCompletionPending = twoSided
        onSwipeStart(emptyMap())
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

        val rawTranslation = startOffset + (effectiveTranslation * friction)
        // Always clamp: never allow translation past closed position (0)
        val clampedTranslation = if (isLeading) maxOf(0f, rawTranslation) else minOf(0f, rawTranslation)
        val targetTranslation = if (twoSided) {
            SwipePhysics.applyLatchedTranslation(startOffset, effectiveTranslation, friction, actionsWidthPx, gestureSide ?: return)
        } else SwipePhysics.applyRubberBand(clampedTranslation, actionsWidthPx, isLeading)

        currentTranslation = targetTranslation
        contentView?.translationX = targetTranslation
        updateActionsTransform()

        // Emit onSwipeStateChange when threshold crossing changes intended state
        val thresholdDistance = actionsWidthPx * threshold
        val decisionTranslation = if (twoSided) effectiveTranslation * friction else targetTranslation
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
            openInternal(gestureSide ?: legacySide, openingVelocity, preserveGestureCompletion = true)
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
        if (twoSided) {
            for (side in SwipeSide.values()) {
                val rail = railFor(side) ?: continue
                val width = widthFor(side)
                val progress = if (side == activeSide && width > 0f) minOf(abs(currentTranslation) / width, 1f) else 0f
                rail.translationX = -side.sign * width * (1f - progress)
            }
            refreshRailVisibility()
            return
        }
        val actions = actionsView ?: return
        if (actionsWidthPx <= 0f) return

        val progress = minOf(abs(currentTranslation) / actionsWidthPx, 1f)
        val offset = if (isLeading) -actionsWidthPx else actionsWidthPx
        val actionsTranslateX = offset * (1f - progress)

        actions.translationX = actionsTranslateX
    }

    private fun shouldSyncOpenLayoutForPropChange(oldValue: Float, newValue: Float): Boolean {
        if (oldValue == newValue) return false
        if (!isOpen || isDragging || isAnimating || isGestureActivated) return false
        return newValue > 0f
    }

    private fun syncOpenStateToCurrentWidth() {
        val targetX = if (isLeading) actionsWidthPx else -actionsWidthPx
        currentTranslation = targetX
        contentView?.translationX = targetX

        if (actionsView != null) {
            actionsView?.visibility = View.VISIBLE
            actionsView?.translationX = 0f
        } else {
            onSwipeStart(emptyMap())
        }

        startLayoutGuard()
        emitFinalProgress(1f, targetX)
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
        if (twoSided && !isSideEnabled(side)) return
        if (!twoSided && side != legacySide) return
        val previousSide = gestureSide ?: animationSide ?: openSide
        if (twoSided && previousSide != null && previousSide != side && (isOpen || currentTranslation != 0f || isAnimating)) {
            closeInternal(animated = true, afterClose = { open(side, velocity) })
            return
        }
        cancelActiveWork(preserveGestureCompletion)
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
            if (twoSided && !autoClose) emitSwipeEnd("open", side)
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
                // With autoClose, let close() emit onSwipeEnd("open") instead
                if (!autoClose) {
                    emitSwipeEnd("open", side)
                }
            }
            start()
        }
        // Actions are now driven by updateActionsTransform() called from content's update listener
    }

    /** Retains the legacy direct entry point and restore callback cadence. */
    fun snapToOpen() {
        applyPendingConfiguration()
        val side = if (twoSided) openSide ?: defaultOpenSide() ?: return else legacySide
        snapToOpen(side)
    }

    private fun snapToOpen(side: SwipeSide) {
        if (twoSided && !isSideEnabled(side)) return
        cancelActiveWork()
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
        } else if (!twoSided) {
            onSwipeStart(emptyMap())
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
        val side = activeSide ?: legacySide
        val width = widthFor(side)
        cancelActiveWork(preserveGestureCompletion || autoCloseCompletion)
        val generation = workGeneration
        animationSide = side
        autoCloseClosingSide = if (autoCloseCompletion) side else null
        isOpen = false
        openSide = null
        pendingShouldOpen = false
        recycleSnapPending = false
        restorePending = false
        pendingRestoreSide = null
        if (animated || twoSided) persistOpenSide(null)

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
            autoCloseClosingSide = null
            if (twoSided) emitSwipeEnd(if (autoCloseCompletion) "open" else "closed", side)
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
                autoCloseClosingSide = null
                emitSwipeEnd(if (autoCloseCompletion) "open" else "closed", side)
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
        // The direct API's start is the equivalent of a fresh ACTION_DOWN.
        isCurrentTouchCancelled = false
        if (twoSided) {
            cancelActiveWork()
            directGesturePending = true
            return
        }
        // Direct legacy gestures intentionally do not emit threshold state changes,
        // clamp at zero, or schedule auto-close.
        isDragging = true
        startOffset = currentTranslation
        gestureStartTranslation = 0f
        isGestureActivated = true
        lastEmittedWillEndState = if (isOpen) "open" else "closed"
        val generation = workGeneration
        onSwipeStart(emptyMap())
        if (generation != workGeneration || !isGestureActivated) return
        startProgressUpdates()
    }

    fun handleGestureUpdate(translationX: Float, velocityX: Float) {
        if (isCurrentTouchCancelled) return
        if (twoSided) {
            if (directGesturePending && abs(translationX) > touchSlop && abs(translationX) >= dragOffsetFromEdgePx) {
                activateGesture(translationX)
                if (isGestureActivated) gestureStartTranslation = 0f
            }
            handlePanUpdate(translationX)
            return
        }
        if (actionsWidth <= 0f || !isGestureActivated) return
        val rawTranslation = startOffset + (translationX * friction)
        val targetTranslation = SwipePhysics.applyRubberBand(rawTranslation, actionsWidthPx, isLeading)
        currentTranslation = targetTranslation
        contentView?.translationX = targetTranslation
        updateActionsTransform()
    }

    fun handleGestureEnd(translationX: Float, velocityX: Float) {
        if (isCurrentTouchCancelled) return
        directGesturePending = false
        if (twoSided) {
            handlePanEnd(translationX, velocityX)
            return
        }
        if (!isGestureActivated) return
        isGestureActivated = false
        gestureStartTranslation = 0f
        isDragging = false
        stopProgressUpdates()
        val projectedX = SwipePhysics.projectFinalPosition(translationX, velocityX, friction)
        val thresholdDistance = actionsWidthPx * threshold
        val shouldOpen = SwipePhysics.shouldSnapToOpen(projectedX, thresholdDistance, isOpen, isLeading)
        if (shouldOpen) open(velocityX) else close(velocity = velocityX)
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
        applyPendingConfiguration()
        if (twoSided) {
            reconcileSideChildren()
            if (isOpen) openSide?.let(::requestActions)
        }
        if (isOpen && currentTranslation != 0f) {
            postCurrent {
                if (isOpen && currentTranslation != 0f && !isDragging && !isAnimating) {
                    contentView?.translationX = currentTranslation
                    updateActionsTransform()
                    actionsView?.visibility = View.VISIBLE
                }
            }
            if (autoClose) scheduleAutoClose()
        }
    }

    override fun onDetachedFromWindow() {
        bindingGeneration++
        super.onDetachedFromWindow()
        cancelActiveWork()
        removeCallbacks(configurationRunnable)
        velocityTracker?.recycle()
        velocityTracker = null
        requestedActions.clear()
        observedSlotCounts.clear()
        recyclingKey?.let { unregisterView(this, it) }
        if (twoSided) reconcileLogicalState(restartLayoutGuard = false)
    }

    private fun validWidth(value: Float): Float = if (value.isFinite() && value > 0f) value else 0f

    private fun widthFor(side: SwipeSide): Float = if (!twoSided) actionsWidth * density
        else if (side == SwipeSide.LEFT) leftWidthPx else rightWidthPx

    private fun isSideEnabled(side: SwipeSide): Boolean =
        widthFor(side) > 0f && (twoSided || side == legacySide)

    private fun hasEnabledSide(): Boolean = if (twoSided) leftWidthPx > 0f || rightWidthPx > 0f else actionsWidth > 0f

    private fun defaultOpenSide(): SwipeSide? = if (!twoSided) legacySide else
        SwipePhysics.defaultOpenSide(legacySide, leftWidthPx, rightWidthPx)

    private fun selectGestureSide(translation: Float): SwipeSide? = SwipePhysics.selectSide(
        translation, openSide ?: animationSide, gestureSide, leftWidthPx, rightWidthPx
    )

    private fun railFor(side: SwipeSide?): View? = when (side) {
        SwipeSide.LEFT -> leftActionsView
        SwipeSide.RIGHT -> rightActionsView
        null -> null
    }

    private fun sideMetadata(side: SwipeSide? = activeSide): Map<String, Any> {
        if (!twoSided || side == null) return emptyMap()
        val key = recyclingKey
        return if (key != null) mapOf("side" to side.value, "recyclingKey" to key)
            else mapOf("side" to side.value)
    }

    private fun stateEvent(state: String, side: SwipeSide? = activeSide): Map<String, Any> =
        mapOf("state" to state) + sideMetadata(side)

    private fun emitSwipeEnd(state: String, side: SwipeSide) {
        gestureCompletionPending = false
        onSwipeEnd(stateEvent(state, side))
    }

    private fun requestActions(side: SwipeSide, retryEmptySlot: Boolean = false) {
        // A slot may be emptied without changing this view's own layout bounds.
        if (retryEmptySlot && twoSided && (railFor(side) as? ViewGroup)?.childCount == 0) {
            requestedActions.remove(side)
        }
        if (isSideEnabled(side) && requestedActions.add(side)) {
            onActionsNeeded(mapOf("side" to side.value) + sideMetadata(side))
        }
    }

    private fun configurationChanged() {
        // Invalidates callbacks immediately, but commits related widths/mode/key together.
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
        val cancelsGesture = (twoSided || appliedTwoSided) && (isGestureActivated || gestureCompletionPending)
        val cancelled = if (cancelsGesture) recyclingKey?.let { mapOf<String, Any>("recyclingKey" to it) } ?: emptyMap() else null
        if ((twoSided || appliedTwoSided) && (isGestureActivated || directGesturePending)) {
            // Configuration changes consume the remainder of this physical/direct gesture.
            isCurrentTouchCancelled = true
        }
        val modeChanged = appliedTwoSided != twoSided
        appliedTwoSided = twoSided
        if (modeChanged) {
            cancelActiveWork()
            legacyRolesPending = !twoSided
            // The pointer gate belongs only to the two-sided slot protocol.
            (leftActionsView as? ReactViewGroup)?.pointerEvents = PointerEvents.AUTO
            (rightActionsView as? ReactViewGroup)?.pointerEvents = PointerEvents.AUTO
            for (i in 0 until childCount) {
                getChildAt(i).apply {
                    translationX = 0f
                    visibility = View.VISIBLE
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                }
            }
            contentView = null
            legacyActionsView = null
            leftActionsView = null
            rightActionsView = null
            requestedActions.clear()
            observedSlotCounts.clear()
        }
        if (twoSided) reconcileSideChildren() else if (legacyRolesPending) completeLegacyChildTransition()
        if (pendingGestureDisable && !gestureEnabled) {
            cancelActiveWork()
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
            recycleSnapPending = false
            if (restored != null && (!twoSided || isSideEnabled(restored))) {
                snapToOpen(if (twoSided) restored else legacySide)
            } else if (twoSided) {
                persistOpenSide(null)
                reconcileLogicalState()
            }
        } else if (twoSided || modeChanged) {
            reconcileLogicalState()
        }
        // A preserved auto-close still owns its real completion; do not reset its JS gate.
        if (cancelled != null && !gestureCompletionPending) onGestureCancelled(cancelled)
    }

    private fun reconcileLogicalState(restartLayoutGuard: Boolean = true) {
        val side = openSide
        val deadline = autoCloseDeadline
        val closingSide = autoCloseClosingSide
        val resumesCompletion = twoSided && autoClose && (
            closingSide != null && isSideEnabled(closingSide) ||
                isOpen && side != null && isSideEnabled(side) && deadline != null
            )
        cancelActiveWork(preserveGestureCompletion = resumesCompletion)
        animationSide = null
        if (twoSided && autoClose && closingSide != null && isSideEnabled(closingSide)) {
            // Continue an actual auto-close animation, preserving its original side/intent.
            animationSide = closingSide
            closeInternal(animated = true, autoCloseCompletion = true)
            return
        }
        if (isOpen && side != null && (!twoSided || isSideEnabled(side))) {
            openSide = if (twoSided) side else legacySide
            currentTranslation = openSide!!.sign * widthFor(openSide!!)
            contentView?.translationX = currentTranslation
            updateActionsTransform()
            if (restartLayoutGuard) startLayoutGuard()
        } else {
            isOpen = false
            openSide = null
            resetPosition()
        }
        if (twoSided) persistOpenSide(openSide)
        if (twoSided && autoClose && isOpen && deadline != null) scheduleAutoClose(deadline)
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
        if (twoSided) updateActionsTransform() else {
            legacyActionsView?.translationX = -legacySide.sign * actionsWidth * density
            legacyActionsView?.visibility = View.INVISIBLE
        }
    }

    private fun cancelActiveWork(preserveGestureCompletion: Boolean = false) {
        workGeneration++
        if (!preserveGestureCompletion) gestureCompletionPending = false
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
    }

    private fun interruptAnimation() {
        val side = activeSide
        cancelActiveWork()
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

    private fun completeLegacyChildTransition() {
        if (twoSided || childCount !in 1..2) return
        legacyRolesPending = false
        contentView = getChildAt(childCount - 1)
        legacyActionsView = if (childCount == 2) getChildAt(0) else null
        (legacyActionsView as? ViewGroup)?.apply {
            clipChildren = false
            clipToPadding = false
        }
        contentView?.translationX = currentTranslation
        legacyActionsView?.visibility = if (isOpen || isDragging || isAnimating) View.VISIBLE else View.INVISIBLE
        updateActionsTransform()
    }

    private fun refreshRailVisibility() {
        if (!twoSided) return
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
