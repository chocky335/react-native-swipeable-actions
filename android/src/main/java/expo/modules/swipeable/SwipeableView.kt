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
import com.facebook.react.uimanager.events.NativeGestureUtil
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
        private val openStateCache = LruCache<String, Boolean>(MAX_CACHE_SIZE)

        /** View registry for static method access by recyclingKey */
        private val viewRegistry = mutableMapOf<String, WeakReference<SwipeableView>>()

        /** Lock for thread-safe registry access */
        private val registryLock = Any()

        // Thread-safe accessors (LruCache is already synchronized internally)
        private fun getOpenState(key: String): Boolean = openStateCache[key] ?: false

        private fun setOpenState(key: String, isOpen: Boolean) {
            openStateCache.put(key, isOpen)
        }

        private fun getView(key: String): SwipeableView? = synchronized(registryLock) {
            viewRegistry[key]?.get()
        }

        private fun registerView(view: SwipeableView, key: String) = synchronized(registryLock) {
            viewRegistry[key] = WeakReference(view)
        }

        private fun unregisterView(key: String) = synchronized(registryLock) {
            viewRegistry.remove(key)
        }

        private fun getAllViews(): List<SwipeableView> = synchronized(registryLock) {
            viewRegistry.values.mapNotNull { it.get() }
        }

        // Static methods (by recyclingKey)
        fun openByKey(key: String) {
            getView(key)?.let { view ->
                view.post { view.open() }
            }
        }

        fun closeByKey(key: String, animated: Boolean = true) {
            getView(key)?.let { view ->
                view.post { view.close(animated) }
            }
        }

        /** Close all swipeables. When animated=true, only closes open views. When animated=false, resets all views. */
        fun closeAll(animated: Boolean = true) {
            getAllViews().forEach { view ->
                if (animated) {
                    // Only close open views when animated
                    if (view.isOpen) {
                        view.post { view.close(animated = true) }
                    }
                } else {
                    // Reset all views when not animated
                    view.post { view.close(animated = false) }
                }
            }
        }

        /** Clear all cached state - useful for app reset scenarios */
        fun clearCache() {
            openStateCache.evictAll()
        }
    }

    private val density = context.resources.displayMetrics.density

    var actionsWidth: Float = 0f
        set(value) {
            val validated = maxOf(0f, value)
            if (field == validated) return
            field = validated
            requestLayout()
        }

    private val actionsWidthPx: Float
        get() = actionsWidth * density

    var actionsPosition: String = "right"
        set(value) {
            val validated = if (value == "left" || value == "right") value else "right"
            if (field == validated) return
            field = validated
            requestLayout()
        }

    val isLeading: Boolean get() = actionsPosition == "left"

    var friction: Float = 1.0f
        set(value) { field = value.coerceIn(0f, 1f) }

    var threshold: Float = 0.4f
        set(value) { field = value.coerceIn(0f, 1f) }

    var dragOffsetFromEdge: Float = 0f
        set(value) { field = maxOf(0f, value) }

    var autoClose: Boolean = false

    var autoCloseTimeout: Float = 0f  // milliseconds
        set(value) { field = maxOf(0f, value) }

    private val dragOffsetFromEdgePx: Float
        get() = dragOffsetFromEdge * density

    /** Key for recycling detection - when this changes, view saves/restores state from cache */
    var recyclingKey: String? = null
        set(value) {
            val oldValue = field
            if (oldValue == value) return
            field = value

            // Thread-safe read of new key's state
            val shouldOpen = value?.let { getOpenState(it) } ?: false
            pendingShouldOpen = shouldOpen

            // Thread-safe write of old key's state and unregister
            if (oldValue != null) {
                setOpenState(oldValue, isOpen)
                unregisterView(oldValue)
            }

            // Thread-safe register with new key
            if (value != null) {
                registerView(this, value)
            }

            close(animated = false)

            // Apply using local shouldOpen (pendingShouldOpen was cleared by close)
            if (shouldOpen) {
                post { snapToOpen() }
            }
        }

    private var currentTranslation: Float = 0f
    private var isOpen: Boolean = false
    private var startOffset: Float = 0f
    private var isDragging: Boolean = false
    private var isAnimating: Boolean = false
    private var gestureStartTranslation: Float = 0f
    private var isGestureActivated: Boolean = false
    private var lastEmittedProgress: Float = -1f
    private var pendingShouldOpen: Boolean = false
    private var lastEmittedWillEndState: String? = null

    // Track if open animation was explicitly interrupted by close() for autoClose
    private var openAnimationInterruptedByClose: Boolean = false

    // Override onSwipeEnd state when autoClose triggers close() (emit "open" instead of "closed")
    private var autoCloseEndEventOverride: Boolean = false

    private var contentView: View? = null
    private var actionsView: View? = null

    private val onSwipeProgress by EventDispatcher<Map<String, Any>>()
    private val onSwipeStart by EventDispatcher<Map<String, Any>>()
    private val onSwipeStateChange by EventDispatcher<Map<String, Any>>()
    private val onSwipeEnd by EventDispatcher<Map<String, Any>>()

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var velocityTracker: VelocityTracker? = null
    private var touchStartX: Float = 0f
    private var touchStartY: Float = 0f
    private var isIntercepting: Boolean = false

    // Touch interception for swipe detection
    private var dispatchTouchStartX: Float = 0f
    private var dispatchTouchStartY: Float = 0f
    private var isBlockingChildEvents: Boolean = false

    private var contentSpringAnimation: SpringAnimation? = null
    private var actionsSpringAnimation: SpringAnimation? = null

    private var frameCallback: Choreographer.FrameCallback? = null

    // Gesture timeout for stuck gesture recovery
    private var gestureTimeoutRunnable: Runnable? = null

    // Auto-close runnable for tracking and cancellation
    private var autoCloseRunnable: Runnable? = null

    init {
        clipChildren = false
        clipToPadding = false
        setWillNotDraw(false)
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
                post { snapToOpen() }
            }
        }
    }

    override fun onViewRemoved(child: View?) {
        super.onViewRemoved(child)
        if (child === actionsView) {
            actionsView = null
        } else if (child === contentView) {
            contentView = null
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val width = right - left
        val height = bottom - top

        for (i in 0 until childCount) {
            val child = getChildAt(i)
            if (child === actionsView && actionsWidthPx > 0f) {
                val actionsWidthInt = actionsWidthPx.toInt()
                if (isLeading) {
                    child.layout(0, 0, actionsWidthInt, height)
                } else {
                    child.layout(width - actionsWidthInt, 0, width, height)
                }
            } else {
                child.layout(0, 0, width, height)
            }
        }

        if (!isDragging && !isAnimating && currentTranslation == 0f && actionsWidthPx > 0f) {
            val actionsOffset = if (isLeading) -actionsWidthPx else actionsWidthPx
            actionsView?.translationX = actionsOffset
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
        if (actionsWidth <= 0f) {
            return super.dispatchTouchEvent(event)
        }

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dispatchTouchStartX = event.rawX
                dispatchTouchStartY = event.rawY
                isBlockingChildEvents = false

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
                    val horizontalDelta = event.rawX - dispatchTouchStartX
                    val isCorrectDirection = if (isOpen) {
                        true
                    } else {
                        if (isLeading) horizontalDelta > 0 else horizontalDelta < 0
                    }

                    if (isCorrectDirection) {
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
        if (actionsWidth <= 0f) return false

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchStartX = event.rawX
                touchStartY = event.rawY
                isIntercepting = false

                if (isAnimating) {
                    contentSpringAnimation?.cancel()
                    isAnimating = false
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
                    val isCorrectDirection = if (isOpen) {
                        true
                    } else {
                        if (isLeading) horizontalDelta > 0 else horizontalDelta < 0
                    }
                    val meetsOffset = dragOffsetFromEdgePx <= 0f || abs(horizontalDelta) >= dragOffsetFromEdgePx

                    if (isCorrectDirection && meetsOffset) {
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
        if (actionsWidth <= 0f) return false

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
                    if (meetsOffset) {
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
                    handlePanEnd(horizontalDelta, velocityTracker?.xVelocity ?: 0f)
                }
                velocityTracker?.recycle()
                velocityTracker = null
                isIntercepting = false
            }
        }
        return isGestureActivated || isIntercepting
    }

    private fun activateGesture(initialTranslation: Float) {
        // Cancel any running animations and capture current position
        contentSpringAnimation?.let { anim ->
            if (anim.isRunning) {
                currentTranslation = contentView?.translationX ?: currentTranslation
                anim.cancel()
            }
        }
        actionsSpringAnimation?.cancel()
        isAnimating = false

        isGestureActivated = true
        isDragging = true
        startOffset = currentTranslation
        gestureStartTranslation = initialTranslation
        lastEmittedWillEndState = if (isOpen) "open" else "closed"

        actionsView?.visibility = View.VISIBLE
        parent?.requestDisallowInterceptTouchEvent(true)  // Prevent parent from stealing gesture

        onSwipeStart(emptyMap())
        startProgressUpdates()
        startGestureTimeout()
    }

    private fun startGestureTimeout() {
        cancelGestureTimeout()
        gestureTimeoutRunnable = Runnable {
            if (isGestureActivated) {
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
    }

    private fun scheduleAutoClose() {
        cancelAutoClose()
        val delay = if (autoCloseTimeout > 0) autoCloseTimeout.toLong() else 0L
        autoCloseRunnable = Runnable {
            autoCloseRunnable = null
            // Emit "open" state when autoClose completes - user's swipe intent was achieved
            autoCloseEndEventOverride = true
            close()
        }
        postDelayed(autoCloseRunnable, delay)
    }

    private fun handlePanUpdate(translationX: Float) {
        if (!isGestureActivated || actionsWidth <= 0f) return

        val effectiveTranslation = translationX - gestureStartTranslation

        val rawTranslation = startOffset + (effectiveTranslation * friction)
        // Always clamp: never allow translation past closed position (0)
        val clampedTranslation = if (isLeading) maxOf(0f, rawTranslation) else minOf(0f, rawTranslation)
        val targetTranslation = SwipePhysics.applyRubberBand(clampedTranslation, actionsWidthPx, isLeading)

        currentTranslation = targetTranslation
        contentView?.translationX = targetTranslation
        updateActionsTransform()

        // Emit onSwipeStateChange when threshold crossing changes intended state
        val thresholdDistance = actionsWidthPx * threshold
        val wouldOpen = SwipePhysics.shouldSnapToOpen(targetTranslation, thresholdDistance, isOpen, isLeading)
        val intendedState = if (wouldOpen) "open" else "closed"
        if (lastEmittedWillEndState != intendedState) {
            lastEmittedWillEndState = intendedState
            onSwipeStateChange(mapOf("state" to intendedState))
        }
    }

    private fun handlePanEnd(translationX: Float, velocityX: Float) {
        if (!isGestureActivated) return

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
            onSwipeStateChange(mapOf("state" to intendedState))
        }

        if (shouldOpen) {
            // Only use velocity if it's in the opening direction (prevents backward bounce)
            val openingVelocity = if (isLeading) {
                if (velocityX > 0) velocityX else 0f  // Leading: positive velocity opens
            } else {
                if (velocityX < 0) velocityX else 0f  // Trailing: negative velocity opens
            }
            open(openingVelocity)
            // Schedule auto-close if enabled
            if (autoClose) {
                scheduleAutoClose()
            }
        } else {
            // Only use velocity if it's in the closing direction (prevents backward bounce)
            val closingVelocity = if (isLeading) {
                if (velocityX < 0) velocityX else 0f  // Leading: negative velocity closes
            } else {
                if (velocityX > 0) velocityX else 0f  // Trailing: positive velocity closes
            }
            close(velocity = closingVelocity)
        }
    }

    private fun updateActionsTransform() {
        val actions = actionsView ?: return
        if (actionsWidthPx <= 0f) return

        val progress = minOf(abs(currentTranslation) / actionsWidthPx, 1f)
        val offset = if (isLeading) -actionsWidthPx else actionsWidthPx
        val actionsTranslateX = offset * (1f - progress)

        actions.translationX = actionsTranslateX
    }

    fun open(velocity: Float = 0f) {
        isOpen = true
        isAnimating = true
        // Thread-safe persist to static cache for FlashList recycling
        recyclingKey?.let { key -> setOpenState(key, true) }
        // Note: actionsView visibility is already set during drag phase
        if (actionsView?.visibility != View.VISIBLE) {
            actionsView?.visibility = View.VISIBLE
        }
        val targetX = if (isLeading) actionsWidthPx else -actionsWidthPx

        val springVelocity = SwipePhysics.calculateSpringVelocity(velocity)

        // Start progress updates to emit progress during animation
        startProgressUpdates()

        // Reset the flag - close() will set it to true if it interrupts us
        openAnimationInterruptedByClose = false
        contentSpringAnimation?.cancel()
        actionsSpringAnimation?.cancel()

        val content = contentView
        val actions = actionsView

        if (content == null) {
            currentTranslation = targetX
            isAnimating = false
            emitFinalProgress(1f, targetX)
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
                currentTranslation = value
                updateActionsTransform()
            }
            addEndListener { _, _, _, _ ->
                if (openAnimationInterruptedByClose) {
                    // Animation was interrupted by close() (e.g., autoClose)
                    return@addEndListener
                }
                isAnimating = false
                emitFinalProgress(1f, targetX)
                // With autoClose, let close() emit onSwipeEnd("open") instead
                if (!autoClose) {
                    onSwipeEnd(mapOf("state" to "open"))
                }
            }
            start()
        }
        // Actions are now driven by updateActionsTransform() called from content's update listener
    }

    /** Instantly snap to open state without animation (for recycling) */
    fun snapToOpen() {
        contentSpringAnimation?.cancel()
        actionsSpringAnimation?.cancel()

        isOpen = true
        isAnimating = false
        val targetX = if (isLeading) actionsWidthPx else -actionsWidthPx
        currentTranslation = targetX

        // Set content translation immediately
        contentView?.translationX = targetX

        if (actionsView != null) {
            // Actions already mounted - position them
            actionsView?.visibility = View.VISIBLE
            actionsView?.translationX = 0f
        } else {
            // Actions not mounted yet (React lazy rendering)
            // Trigger onSwipeStart so React renders SwipeableActions
            // onViewAdded will handle positioning when actions are added
            onSwipeStart(emptyMap())
        }

        // Emit final progress
        emitFinalProgress(1f, targetX)
    }

    fun close(animated: Boolean = true, velocity: Float = 0f) {
        cancelAutoClose()
        stopProgressUpdates()

        // Cancel any running animations
        openAnimationInterruptedByClose = true
        contentSpringAnimation?.cancel()
        actionsSpringAnimation?.cancel()

        // Clear gesture state (unified from reset)
        isDragging = false
        isGestureActivated = false
        gestureStartTranslation = 0f
        pendingShouldOpen = false

        isOpen = false
        // Only persist to cache when animated (user action), not when resetting (recycling)
        if (animated) {
            recyclingKey?.let { key -> setOpenState(key, false) }
        }

        val actionsOffset = if (isLeading) -actionsWidthPx else actionsWidthPx

        if (animated) {
            // Animated close with spring physics
            isAnimating = true
            startProgressUpdates()

            val springVelocity = SwipePhysics.calculateSpringVelocity(velocity)
            val content = contentView

            if (content == null) {
                currentTranslation = 0f
                actionsView?.translationX = actionsOffset
                isAnimating = false
                openAnimationInterruptedByClose = false
                emitFinalProgress(0f, 0f)
                return
            }

            // Define bounds and clamp starting position
            val minBound = if (isLeading) 0f else -actionsWidthPx
            val maxBound = if (isLeading) actionsWidthPx else 0f

            val clampedStart = content.translationX.coerceIn(minBound, maxBound)
            val wasClamped = content.translationX != clampedStart
            if (wasClamped) {
                content.translationX = clampedStart
                currentTranslation = clampedStart
            }

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
                    currentTranslation = value
                    updateActionsTransform()
                }
                addEndListener { _, _, _, _ ->
                    isAnimating = false
                    openAnimationInterruptedByClose = false
                    actionsView?.visibility = View.INVISIBLE
                    emitFinalProgress(0f, 0f)
                    // Emit "open" when autoClose completes - user's swipe intent was achieved
                    val endState = if (autoCloseEndEventOverride) "open" else "closed"
                    autoCloseEndEventOverride = false
                    onSwipeEnd(mapOf("state" to endState))
                }
                start()
            }
        } else {
            // Instant close (formerly reset)
            isAnimating = false
            openAnimationInterruptedByClose = false
            currentTranslation = 0f
            startOffset = 0f
            lastEmittedProgress = -1f

            contentView?.translationX = 0f
            actionsView?.translationX = actionsOffset
            actionsView?.visibility = View.INVISIBLE
        }
    }

    fun handleGestureStart() {
        if (actionsWidth <= 0f) return

        isDragging = true
        startOffset = currentTranslation
        gestureStartTranslation = 0f
        isGestureActivated = true
        lastEmittedWillEndState = if (isOpen) "open" else "closed"
        onSwipeStart(emptyMap())
        startProgressUpdates()
    }

    fun handleGestureUpdate(translationX: Float, velocityX: Float) {
        if (actionsWidth <= 0f || !isGestureActivated) return

        val rawTranslation = startOffset + (translationX * friction)
        val targetTranslation = SwipePhysics.applyRubberBand(rawTranslation, actionsWidthPx, isLeading)

        currentTranslation = targetTranslation
        contentView?.translationX = targetTranslation
        updateActionsTransform()
    }

    fun handleGestureEnd(translationX: Float, velocityX: Float) {
        if (!isGestureActivated) return

        isGestureActivated = false
        gestureStartTranslation = 0f
        isDragging = false
        stopProgressUpdates()

        val projectedX = SwipePhysics.projectFinalPosition(translationX, velocityX, friction)
        val thresholdDistance = actionsWidthPx * threshold
        val shouldOpen = SwipePhysics.shouldSnapToOpen(projectedX, thresholdDistance, isOpen, isLeading)

        if (shouldOpen) {
            open(velocityX)
        } else {
            close(velocity = velocityX)
        }
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
            ))
        }
    }

    private fun emitFinalProgress(progress: Float, translationX: Float) {
        lastEmittedProgress = progress
        // Use fresh map for each emission
        onSwipeProgress(mapOf(
            "progress" to progress.toDouble(),
            "translationX" to translationX.toDouble()
        ))
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stopProgressUpdates()
        cancelGestureTimeout()
        cancelAutoClose()
        contentSpringAnimation?.cancel()
        actionsSpringAnimation?.cancel()
        velocityTracker?.recycle()
        velocityTracker = null
        // Reset state
        isAnimating = false
        isDragging = false
        isGestureActivated = false
        // Thread-safe deregister from view registry
        recyclingKey?.let { unregisterView(it) }
    }
}
