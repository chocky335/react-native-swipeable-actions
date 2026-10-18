package expo.modules.swipeable

import android.app.Activity
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.RootView
import com.facebook.react.uimanager.TouchTargetHelper
import com.facebook.react.views.view.ReactViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.ViewEventCallback
import expo.modules.kotlin.viewevent.ViewEventDelegate
import io.mockk.*
import java.time.Duration
import kotlin.reflect.KProperty
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowChoreographer

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, qualifiers = "xhdpi")
@LooperMode(LooperMode.Mode.PAUSED)
class SwipeableViewTest {
    private lateinit var controller: ActivityController<Activity>
    private lateinit var activity: Activity
    private lateinit var root: FrameLayout
    private val events = mutableListOf<Pair<String, Map<String, Any>>>()
    private var eventObserver: ((String, Map<String, Any>) -> Unit)? = null
    private var nativeGestureStarts = 0

    @Before fun setUp() {
        // AndroidX retains its Choreographer in a thread-local across Robolectric
        // tests, while Robolectric replaces the underlying looper/frame queue.
        val handler = Class.forName("androidx.dynamicanimation.animation.AnimationHandler")
        val threadLocal = handler.getDeclaredField("sAnimatorHandler").apply { isAccessible = true }
        (threadLocal.get(null) as ThreadLocal<*>).remove()
        ShadowChoreographer.setPaused(true)
        ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
        // Observe events emitted by the real view and spring listeners, without requiring a JS runtime.
        mockkConstructor(ViewEventDelegate::class)
        every { anyConstructed<ViewEventDelegate<Map<String, Any>>>().getValue(any(), any()) } answers {
            val name = secondArg<KProperty<*>>().name
            ViewEventCallback<Map<String, Any>> { body ->
                events += name to body.toMap()
                eventObserver?.invoke(name, body)
            }
        }
        SwipeableView.clearCache()
        controller = Robolectric.buildActivity(Activity::class.java).setup()
        activity = controller.get()
        root = object : FrameLayout(activity), RootView {
            override fun onChildStartedNativeGesture(childView: View?, ev: MotionEvent) {
                nativeGestureStarts++
            }
            override fun onChildEndedNativeGesture(childView: View, ev: MotionEvent) {}
            override fun handleException(t: Throwable) { throw t }
        }
        activity.setContentView(root)
        controller.visible()
    }

    @After fun tearDown() {
        root.removeAllViews()
        controller.pause().stop().destroy()
        SwipeableView.clearCache()
        unmockkAll()
    }

    @Test fun singleSideUsesStableSlotsAndRightDefaultOpen() {
        val row = row(bothSides = false)
        assertEquals(0f, row.leftActionsWidth, 0f)
        assertEquals(80f, row.rightActionsWidth, 0f)
        assertEquals(3, row.childCount)
        row.open()
        settle()
        assertEquals(-160f, content(row).translationX, .01f)
        assertEquals(listOf("open:right"), ends())
        assertEquals(0, named("onSwipeStart").size)
    }

    @Test fun singleSideRejectsDisabledDirectionAndEmitsThresholdState() {
        val row = row(bothSides = false)
        row.handleGestureStart()
        row.handleGestureUpdate(60f, 0f)
        assertEquals(0f, content(row).translationX, 0f)
        assertEquals(0, named("onSwipeStart").size)
        assertTrue(named("onSwipeStateChange").isEmpty())
        row.handleGestureUpdate(-100f, 0f)
        assertEquals(-100f, content(row).translationX, .01f)
        assertEquals(1, named("onSwipeStart").size)
        row.handleGestureEnd(-100f, 0f)
        settle()
        assertEquals(listOf("open:right"), ends())
        assertEquals(listOf("open"), named("onSwipeStateChange").map { it["state"] })
    }

    @Test fun singleSideProgrammaticOpenAndDirectAutoCloseUseCanonicalPolicy() {
        val row = row(bothSides = false)
        row.autoClose = true
        row.open()
        settle()
        assertTrue(SwipeableView.isOpenByKey("row"))
        assertTrue(ends().isEmpty())
        row.close(false)
        row.handleGestureStart()
        row.handleGestureUpdate(-100f, 0f)
        row.handleGestureEnd(-100f, 0f)
        settle()
        assertEquals(0f, content(row).translationX, .01f)
        assertFalse(SwipeableView.isOpenByKey("row"))
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun dpWidthsConvertOnceAndProgressTranslationRemainsPixels() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(160f, content(row).translationX, .01f)
        assertEquals(160.0, named("onSwipeProgress").last()["translationX"])
        row.open(SwipeSide.RIGHT)
        settle()
        assertEquals(-240f, content(row).translationX, .01f)
    }

    @Test fun initialAndHiddenRailsAreInvisibleAndExcludedFromAccessibility() {
        val row = row()
        assertHidden(row.getChildAt(0))
        assertHidden(row.getChildAt(1))
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(View.VISIBLE, row.getChildAt(0).visibility)
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO, row.getChildAt(0).importantForAccessibility)
        assertHidden(row.getChildAt(1))
        row.close()
        settle()
        assertHidden(row.getChildAt(0))
        assertHidden(row.getChildAt(1))
    }

    @Test fun programmaticOpenRequestsOnlySelectedLazyActionsWithoutGestureStart() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        (row.getChildAt(0) as FrameLayout).addView(View(activity))
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(listOf("left"), named("onActionsNeeded").map { it["side"] })
        assertTrue(named("onSwipeStart").isEmpty())
    }

    @Test fun oppositeProgrammaticOpenReportsOrderedSideCompletions() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.open(SwipeSide.RIGHT)
        settle()
        assertEquals(listOf("closed:left", "open:right"), ends())
        assertEquals("right", SwipeableView.getOpenSideByKey("row"))
        assertEquals(-240f, content(row).translationX, .01f)
    }

    @Test fun interruptedOppositeOpenDoesNotRunItsContinuation() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.open(SwipeSide.RIGHT)
        row.close(false)
        settle()
        assertTrue(ends().isEmpty())
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertEquals(0f, content(row).translationX, 0f)
    }

    @Test fun directTwoSidedGestureLatchesAndCannotOpenAcrossZero() {
        val row = row()
        row.handleGestureStart()
        row.handleGestureUpdate(100f, 0f)
        assertEquals(100f, content(row).translationX, .01f)
        row.handleGestureUpdate(-400f, 0f)
        assertEquals(0f, content(row).translationX, 0f)
        row.handleGestureEnd(-400f, 0f)
        settle()
        assertEquals(listOf("closed:left"), ends())
        assertEquals(listOf("left"), named("onActionsNeeded").map { it["side"] })
    }

    @Test fun alreadyOpenReleaseUsesRelativeDragAndSideWidth() {
        val row = row()
        row.open(SwipeSide.RIGHT)
        settle()
        row.handleGestureStart()
        row.handleGestureUpdate(60f, 0f)
        row.handleGestureEnd(60f, 0f)
        settle()
        assertEquals("right", SwipeableView.getOpenSideByKey("row"))
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        settle()
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertEquals("closed:right", ends().last())
    }

    @Test fun disabledEdgeCommandAndGestureAreNoOps() {
        val row = row()
        row.leftActionsWidth = 0f
        row.applyPendingConfiguration()
        row.open(SwipeSide.LEFT)
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertTrue(ends().isEmpty())
        assertTrue(named("onSwipeStart").isEmpty())
        row.open()
        settle()
        assertEquals("right", SwipeableView.getOpenSideByKey("row"))
    }

    @Test fun activeWidthRemovalCancelsAnimationWithoutSyntheticCompletion() {
        val row = row()
        row.open(SwipeSide.LEFT)
        row.leftActionsWidth = Float.NaN
        row.applyPendingConfiguration()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertTrue(ends().isEmpty())
    }

    @Test fun positiveWidthChangeReconcilesOpenTargetAndActiveGesture() {
        val row = row()
        row.open(SwipeSide.RIGHT)
        row.rightActionsWidth = 150f
        row.applyPendingConfiguration()
        assertEquals(-300f, content(row).translationX, .01f)
        row.handleGestureStart()
        row.handleGestureUpdate(30f, 0f)
        row.rightActionsWidth = 100f
        row.applyPendingConfiguration()
        settle()
        assertEquals(-200f, content(row).translationX, .01f)
        assertTrue(ends().isEmpty())
    }

    @Test fun relatedWidthsCommitCoherently() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.leftActionsWidth = 0f
        row.leftActionsWidth = 110f
        row.applyPendingConfiguration()
        settle()
        assertEquals(220f, content(row).translationX, .01f)
        assertEquals("left", SwipeableView.getOpenSideByKey("row"))
        assertTrue(ends().isEmpty())
    }

    @Test fun restoreUsesCachedEdgeAfterKeyBeforeWidthProps() {
        val first = row(key = "cached")
        first.open(SwipeSide.LEFT)
        settle()
        root.removeView(first)
        events.clear()
        val restored = SwipeableView(activity, mockk<AppContext>(relaxed = true))
        restored.recyclingKey = "cached"
        restored.leftActionsWidth = 95f
        restored.rightActionsWidth = 130f
        restored.applyPendingConfiguration()
        repeat(3) { restored.addView(FrameLayout(activity)) }
        root.addView(restored)
        restored.layout(0, 0, 400, 64)
        settle()
        assertEquals(190f, content(restored).translationX, .01f)
        assertEquals("left", SwipeableView.getOpenSideByKey("cached"))
        assertTrue(named("onSwipeStart").isEmpty())
        assertTrue(named("onActionsNeeded").all { it["side"] == "left" })
    }

    @Test fun unavailableCachedEdgeRestoresClosedRatherThanOpposite() {
        val row = row(key = "cached")
        row.open(SwipeSide.LEFT)
        settle()
        row.recyclingKey = "other"
        row.leftActionsWidth = 0f
        row.recyclingKey = "cached"
        row.applyPendingConfiguration()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("cached"))
    }

    @Test fun rebindInvalidatesPendingRestoreAndAutoClose() {
        val row = row(key = "a")
        row.autoClose = true
        row.autoCloseTimeout = 100f
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        row.recyclingKey = "b"
        row.autoClose = false
        row.applyPendingConfiguration()
        row.open(SwipeSide.RIGHT)
        settle()
        assertNull(SwipeableView.getOpenSideByKey("a"))
        assertEquals("right", SwipeableView.getOpenSideByKey("b"))
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun autoCloseReportsOpenIntentOnTriggeringSideAtZero() {
        val row = row()
        row.autoClose = true
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        settle()
        assertEquals(listOf("open:left"), ends())
        assertEquals(0f, content(row).translationX, 0f)
        assertEquals(0.0, named("onSwipeProgress").last()["progress"])
        assertEquals("left", named("onSwipeProgress").last()["side"])
        assertFalse(SwipeableView.isOpenByKey("row"))
    }

    @Test fun disablingGestureCancelsAutoCloseOverrideAndContinuation() {
        val row = row()
        row.autoClose = true
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        row.gestureEnabled = false
        row.applyPendingConfiguration()
        settle()
        row.gestureEnabled = true
        row.autoClose = false
        row.applyPendingConfiguration()
        row.open(SwipeSide.RIGHT)
        settle()
        row.close()
        settle()
        assertEquals(listOf("open:right", "closed:right"), ends())
    }

    @Test fun incompleteSlotInsertionNeverTreatsARailAsContent() {
        val row = row(children = false)
        val left = FrameLayout(activity)
        val right = FrameLayout(activity)
        row.addView(left)
        row.open(SwipeSide.LEFT)
        row.addView(right)
        assertTrue(left.translationX <= 0f)
        assertTrue(right.translationX >= 0f)
        val content = FrameLayout(activity)
        row.addView(content)
        row.layout(0, 0, 400, 64)
        assertEquals(160f, content.translationX, .01f)
        assertEquals(0f, left.translationX, .01f)
    }

    @Test fun remountingAUsedSlotRequestsActionsAgain() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        val left = row.getChildAt(0)
        row.removeView(left)
        row.addView(FrameLayout(activity), 0)
        row.layout(0, 0, 400, 64)
        assertTrue(named("onActionsNeeded").any { it["side"] == "left" })
        assertEquals(160f, content(row).translationX, .01f)
    }

    @Test fun recycledOldViewCannotUnregisterReplacement() {
        val old = row(key = "shared")
        val replacement = row(key = "shared")
        root.removeView(old)
        SwipeableView.openByKeyOnSide("shared", SwipeSide.RIGHT)
        settle()
        assertEquals(-240f, content(replacement).translationX, .01f)
        assertEquals("right", SwipeableView.getOpenSideByKey("shared"))
    }

    @Test fun queuedCommandCannotAffectReboundView() {
        val row = row(key = "a")
        SwipeableView.openByKeyOnSide("a", SwipeSide.LEFT)
        row.recyclingKey = "b"
        row.applyPendingConfiguration()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("b"))
    }

    @Test fun detachAndReattachPreserveRegistrySideAndSettledWidth() {
        val row = row()
        row.open(SwipeSide.RIGHT)
        settle()
        root.removeView(row)
        root.addView(row)
        settle()
        assertEquals(-240f, content(row).translationX, .01f)
        SwipeableView.closeByKey("row", false)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertFalse(SwipeableView.isOpenByKey("row"))
    }

    @Test fun singleSideInstantCloseClearsCacheWithoutSyntheticRestoreStart() {
        val row = row(bothSides = false)
        row.open()
        settle()
        row.close(false)
        assertFalse(SwipeableView.isOpenByKey("row"))
        root.removeView(row)
        events.clear()
        val restored = row(bothSides = false, children = false)
        settle()
        assertEquals(0, named("onSwipeStart").size)
        repeat(3) { restored.addView(FrameLayout(activity)) }
        assertEquals(0f, content(restored).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertTrue(named("onActionsNeeded").isEmpty())
    }

    @Test fun nestedGestureClaimAndVerticalMovementAreNotIntercepted() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 10f, 10f).useEvent { row.onInterceptTouchEvent(it) }
        row.requestDisallowInterceptTouchEvent(true)
        motion(MotionEvent.ACTION_MOVE, 110f, 12f).useEvent { assertFalse(row.onInterceptTouchEvent(it)) }
        row.requestDisallowInterceptTouchEvent(false)
        motion(MotionEvent.ACTION_MOVE, 12f, 110f).useEvent { assertFalse(row.onInterceptTouchEvent(it)) }
    }

    @Test fun keyedSingleAndBothSidePayloadsCarryIdentity() {
        val row = row(key = "identity")
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        settle()
        for (name in listOf("onActionsNeeded", "onSwipeProgress", "onSwipeStateChange", "onSwipeEnd")) {
            assertTrue("Missing $name", named(name).isNotEmpty())
            assertTrue(named(name).all { it["recyclingKey"] == "identity" && it["side"] == "left" })
        }
        assertEquals(listOf(mapOf("side" to "left", "recyclingKey" to "identity")), named("onSwipeStart"))
        events.clear()
        val single = row(bothSides = false, key = "single")
        single.handleGestureStart()
        single.handleGestureUpdate(-120f, 0f)
        single.handleGestureEnd(-120f, 0f)
        settle()
        for (name in listOf("onActionsNeeded", "onSwipeProgress", "onSwipeStateChange", "onSwipeEnd")) {
            assertTrue("Missing $name", named(name).isNotEmpty())
            assertTrue(named(name).all { it["recyclingKey"] == "single" && it["side"] == "right" })
        }
        assertEquals(listOf(mapOf("side" to "right", "recyclingKey" to "single")), named("onSwipeStart"))
        assertEquals(setOf("state", "side", "recyclingKey"), named("onSwipeEnd").last().keys)
        assertEquals(setOf("progress", "translationX", "side", "recyclingKey"), named("onSwipeProgress").last().keys)
    }

    @Test fun unchangedSideWidthsDoNotInterruptSingleSideGesture() {
        val row = row(bothSides = false)
        row.handleGestureStart()
        row.handleGestureUpdate(-60f, 0f)
        row.leftActionsWidth = 0f
        row.rightActionsWidth = 80f
        row.applyPendingConfiguration()
        row.handleGestureUpdate(-100f, 0f)
        assertEquals(-100f, content(row).translationX, .01f)
        row.handleGestureEnd(-100f, 0f)
        settle()
        assertEquals(listOf("open:right"), ends())
        assertEquals(1, named("onSwipeStart").size)
    }

    @Test fun singleSideReconfigurationWaitsForCompleteReplacementSlots() {
        val row = row()
        row.open(SwipeSide.RIGHT)
        settle()
        val content = content(row)
        row.leftActionsWidth = 0f
        row.rightActionsWidth = 80f
        row.applyPendingConfiguration()
        row.removeViewAt(0)
        row.removeViewAt(0)
        assertSame(content, row.getChildAt(0))
        assertEquals(-160f, content.translationX, .01f)
        row.addView(FrameLayout(activity), 0)
        assertSame(content, row.getChildAt(1))
        row.addView(FrameLayout(activity), 1)
        settle()
        assertSame(content, row.getChildAt(2))
        assertEquals(-160f, content.translationX, .01f)
        row.close(false)
        assertEquals(0f, content.translationX, 0f)
    }

    @Test fun slotContentResetCanBeRequestedWithoutParentLayout() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        val slot = row.getChildAt(0) as FrameLayout
        slot.addView(View(activity))
        row.close(false)
        slot.removeAllViews()
        events.clear()
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(listOf("left"), named("onActionsNeeded").map { it["side"] })
    }

    @Test fun detachDuringOppositeTransitionCannotReopenTheOtherSide() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.open(SwipeSide.RIGHT)
        root.removeView(row)
        root.addView(row)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertTrue(ends().isEmpty())
    }

    @Test fun oldDetachedViewCannotOverwriteReplacementCache() {
        val old = row(key = "shared")
        old.open(SwipeSide.LEFT)
        settle()
        val replacement = row(key = "shared")
        replacement.open(SwipeSide.RIGHT)
        settle()
        root.removeView(old)
        assertEquals("right", SwipeableView.getOpenSideByKey("shared"))
    }

    @Test fun rawViewQueuedCommandCannotAffectReboundItem() {
        val row = row(key = "a")
        row.postCommand { row.open(SwipeSide.LEFT) }
        row.recyclingKey = "b"
        row.applyPendingConfiguration()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertTrue(ends().isEmpty())
    }

    @Test fun contentTranslationIsRestoredAfterLayoutReset() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        content(row).translationX = 0f
        row.layout(0, 0, 420, 64)
        settle()
        assertEquals(160f, content(row).translationX, .01f)
    }

    @Test fun canceledTouchGestureReconcilesWithoutEndEvent() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 10f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 50f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 150f, 10f).useEvent { row.onTouchEvent(it) }
        assertEquals(100f, content(row).translationX, .01f)
        motion(MotionEvent.ACTION_CANCEL, 150f, 10f).useEvent { row.onTouchEvent(it) }
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertTrue(ends().isEmpty())
    }

    @Test fun disabledGesturesStillPermitProgrammaticOpenAndWidthUpdates() {
        for (bothSides in listOf(false, true)) {
            val row = row(bothSides = bothSides, key = "disabled-$bothSides")
            row.gestureEnabled = false
            row.applyPendingConfiguration()
            row.open()
            settle()
            val content = row.getChildAt(row.childCount - 1)
            assertEquals(if (bothSides) -240f else -160f, content.translationX, .01f)
            row.rightActionsWidth = 150f
            row.applyPendingConfiguration()
            assertEquals(-300f, content.translationX, .01f)
            row.gestureEnabled = true
            row.applyPendingConfiguration()
            row.gestureEnabled = false
            row.applyPendingConfiguration()
            assertEquals(0f, content.translationX, 0f)
        }
    }

    @Test fun closeAllCancelsOppositeSideReopenDuringClosingLeg() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.open(SwipeSide.RIGHT)
        assertFalse(SwipeableView.isOpenByKey("row"))
        SwipeableView.closeAll()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertEquals(listOf("closed:left"), ends())
        assertTrue(named("onActionsNeeded").none { it["side"] == "right" })
    }

    @Test fun queuedStaticOpenThenInstantCloseExecutesBothCommands() {
        for (bothSides in listOf(false, true)) {
            val key = "ordered-$bothSides"
            val row = row(bothSides = bothSides, key = key)
            events.clear()
            SwipeableView.openByKey(key)
            SwipeableView.closeByKey(key, false)
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            // Instant close clears cached intent for every side configuration.
            assertFalse(SwipeableView.isOpenByKey(key))
            assertTrue(ends().isEmpty())
        }
    }

    @Test fun queuedStaticCloseThenOpenCancelsTheClosingAnimation() {
        for (bothSides in listOf(false, true)) {
            val key = "ordered-$bothSides"
            val row = row(bothSides = bothSides, key = key)
            row.open()
            settle()
            events.clear()
            SwipeableView.closeByKey(key)
            SwipeableView.openByKey(key)
            settle()
            assertEquals(if (bothSides) -240f else -160f, row.getChildAt(row.childCount - 1).translationX, .01f)
            assertTrue(SwipeableView.isOpenByKey(key))
            assertEquals(listOf("open:right"), ends())
        }
    }

    @Test fun queuedExplicitSidesCloseTheFirstSideThenOpenTheSecond() {
        val row = row()
        SwipeableView.openByKeyOnSide("row", SwipeSide.LEFT)
        SwipeableView.openByKeyOnSide("row", SwipeSide.RIGHT)
        settle()
        assertEquals(-240f, content(row).translationX, .01f)
        assertEquals("right", SwipeableView.getOpenSideByKey("row"))
        assertEquals(listOf("closed:left", "open:right"), ends())
        assertEquals(listOf("left", "right"), named("onActionsNeeded").map { it["side"] })
        assertTrue(named("onSwipeStart").isEmpty())
    }

    @Test fun queuedRawOpenThenInstantCloseExecutesBothCommands() {
        for (bothSides in listOf(false, true)) {
            val key = "raw-$bothSides"
            val row = row(bothSides = bothSides, key = key)
            events.clear()
            row.postCommand { row.open() }
            row.postCommand { row.close(false) }
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertFalse(SwipeableView.isOpenByKey(key))
            assertTrue(ends().isEmpty())
        }
    }

    @Test fun queuedRawCloseThenOpenCancelsTheClosingAnimation() {
        for (bothSides in listOf(false, true)) {
            val key = "raw-$bothSides"
            val row = row(bothSides = bothSides, key = key)
            row.open()
            settle()
            events.clear()
            row.postCommand { row.close() }
            row.postCommand { row.open() }
            settle()
            assertEquals(if (bothSides) -240f else -160f, row.getChildAt(row.childCount - 1).translationX, .01f)
            assertTrue(SwipeableView.isOpenByKey(key))
            assertEquals(listOf("open:right"), ends())
        }
    }

    @Test fun queuedRawCommandsWithoutAKeyStillExecuteInOrder() {
        val row = row()
        row.recyclingKey = null
        row.applyPendingConfiguration()
        row.postCommand { row.open(SwipeSide.LEFT) }
        row.postCommand { row.close(false) }
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertTrue(ends().isEmpty())
    }

    @Test fun queuedStaticAndRawCommandsCannotSurviveRoundTripRebind() {
        val row = row(key = "a")
        SwipeableView.openByKeyOnSide("a", SwipeSide.LEFT)
        row.postCommand { row.open(SwipeSide.LEFT) }
        row.recyclingKey = "b"
        row.recyclingKey = "a"
        row.applyPendingConfiguration()
        SwipeableView.openByKeyOnSide("a", SwipeSide.RIGHT)
        settle()
        assertEquals(-240f, content(row).translationX, .01f)
        assertEquals(listOf("right"), named("onActionsNeeded").map { it["side"] })
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun queuedStaticAndRawCommandsCannotSurviveDetachAndReattach() {
        val row = row()
        settle()
        SwipeableView.openByKeyOnSide("row", SwipeSide.LEFT)
        row.postCommand { row.open(SwipeSide.LEFT) }
        root.removeView(row)
        root.addView(row)
        row.postCommand { row.open(SwipeSide.RIGHT) }
        settle()
        assertEquals(-240f, content(row).translationX, .01f)
        assertEquals(listOf("right"), named("onActionsNeeded").map { it["side"] })
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun disabledEmptyRightRailDoesNotStealExposedLeftActionPress() {
        val row = reactRow()
        val right = row.getChildAt(1) as ReactViewGroup
        val leftAction = (row.getChildAt(0) as ReactViewGroup).getChildAt(0)
        var presses = 0
        leftAction.setOnClickListener { presses++ }
        row.open(SwipeSide.RIGHT)
        settle()
        right.removeAllViews()
        row.rightActionsWidth = 0f
        row.applyPendingConfiguration()
        row.open(SwipeSide.RIGHT)
        row.handleGestureStart()
        row.handleGestureUpdate(-100f, 0f)
        row.handleGestureEnd(-100f, 0f)
        assertEquals(0f, content(row).translationX, 0f)
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(0, right.childCount)
        assertEquals(400, right.width)
        assertEquals(0f, right.translationX, 0f)
        assertHidden(right)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        tapReactTarget(row, leftAction, 80f)
        assertEquals(1, presses)
        assertEquals("left", SwipeableView.getOpenSideByKey("row"))
    }

    @Test fun disabledRailDescendantsCannotStealReactTouches() {
        val row = reactRow()
        val right = row.getChildAt(1) as ReactViewGroup
        // A prior render may still have descendants while the width update commits.
        right.getChildAt(0).layout(0, 0, 400, 64)
        row.rightActionsWidth = 0f
        row.applyPendingConfiguration()
        row.open(SwipeSide.LEFT)
        settle()
        val leftAction = (row.getChildAt(0) as ReactViewGroup).getChildAt(0)
        assertEquals(leftAction.id, TouchTargetHelper.findTargetTagForTouch(80f, 32f, row))
        assertEquals(content(row).id, TouchTargetHelper.findTargetTagForTouch(300f, 32f, row))
        assertEquals(PointerEvents.NONE, right.pointerEvents)
    }

    @Test fun railPointerEventsFollowSideSwitchCloseAndDisabledGestureOpen() {
        val row = reactRow()
        val left = row.getChildAt(0) as ReactViewGroup
        val right = row.getChildAt(1) as ReactViewGroup
        assertEquals(PointerEvents.NONE, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(PointerEvents.AUTO, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        row.open(SwipeSide.RIGHT)
        settle()
        assertEquals(PointerEvents.NONE, left.pointerEvents)
        assertEquals(PointerEvents.AUTO, right.pointerEvents)
        assertEquals(right.getChildAt(0).id, TouchTargetHelper.findTargetTagForTouch(280f, 32f, row))
        row.close(false)
        assertEquals(PointerEvents.NONE, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        row.gestureEnabled = false
        row.applyPendingConfiguration()
        row.open(SwipeSide.LEFT)
        settle()
        var presses = 0
        left.getChildAt(0).setOnClickListener { presses++ }
        tapReactTarget(row, left.getChildAt(0), 80f)
        assertEquals(1, presses)
    }

    @Test fun singleSideReconfigurationReleasesRemovedRailPointerOwnership() {
        val row = reactRow()
        val left = row.getChildAt(0) as ReactViewGroup
        val right = row.getChildAt(1) as ReactViewGroup
        assertEquals(PointerEvents.NONE, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        row.rightActionsWidth = 0f
        row.applyPendingConfiguration()
        row.removeView(right)
        assertEquals(PointerEvents.AUTO, right.pointerEvents)
        row.addView(right, 1)
        row.open()
        settle()
        assertEquals(3, row.childCount)
        assertEquals(160f, content(row).translationX, .01f)
        assertEquals(PointerEvents.AUTO, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        assertHidden(right)
        var presses = 0
        left.getChildAt(0).setOnClickListener { presses++ }
        tapReactTarget(row, left.getChildAt(0), 80f)
        assertEquals(1, presses)
    }

    @Test fun hiddenRailPointerGateSurvivesRebindDetachAndReattach() {
        val row = reactRow()
        row.rightActionsWidth = 0f
        row.applyPendingConfiguration()
        row.open(SwipeSide.LEFT)
        settle()
        row.recyclingKey = "replacement"
        row.applyPendingConfiguration()
        root.removeView(row)
        root.addView(row, FrameLayout.LayoutParams(400, 64))
        row.open(SwipeSide.LEFT)
        settle()
        val left = row.getChildAt(0) as ReactViewGroup
        val right = row.getChildAt(1) as ReactViewGroup
        assertEquals(PointerEvents.AUTO, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        assertEquals(left.getChildAt(0).id, TouchTargetHelper.findTargetTagForTouch(80f, 32f, row))
        assertEquals("left", SwipeableView.getOpenSideByKey("replacement"))
    }

    @Test fun removedHiddenRailRestoresPointerEventsBeforeReuse() {
        val row = reactRow()
        val right = row.getChildAt(1) as ReactViewGroup
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        row.removeView(right)
        assertEquals(PointerEvents.AUTO, right.pointerEvents)
        row.addView(right, 1)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        row.open(SwipeSide.RIGHT)
        settle()
        assertEquals(PointerEvents.AUTO, right.pointerEvents)
        assertEquals(right.getChildAt(0).id, TouchTargetHelper.findTargetTagForTouch(280f, 32f, row))
    }

    @Test fun cancelPendingDirectGestureCannotActivateUntilAnotherStart() {
        val row = row()
        row.handleGestureStart()
        row.cancelGesture()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureUpdate(-120f, 0f)
        row.handleGestureEnd(-120f, 0f)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertTrue(events.isEmpty())
        row.handleGestureStart()
        row.handleGestureUpdate(-120f, 0f)
        // Fulfill the lazy request before release, as React would.
        (row.getChildAt(1) as FrameLayout).addView(View(activity))
        row.handleGestureEnd(-120f, 0f)
        settle()
        assertEquals(listOf("open:right"), ends())
        assertEquals(listOf("right"), named("onActionsNeeded").map { it["side"] })
    }

    @Test fun cancelActiveDirectGestureSuppressesUpdatesAndCompletionInSingleAndBothSideConfigurations() {
        for (bothSides in listOf(false, true)) {
            val row = row(bothSides = bothSides, key = "cancel-$bothSides")
            row.handleGestureStart()
            row.handleGestureUpdate(-120f, 0f)
            assertEquals(-120f, row.getChildAt(row.childCount - 1).translationX, .01f)
            events.clear()
            row.cancelGesture()
            row.handleGestureUpdate(240f, 0f)
            row.handleGestureEnd(240f, 1000f)
            settle()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(6))
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertFalse(SwipeableView.isOpenByKey("cancel-$bothSides"))
            consumeCancellation("cancel-$bothSides", "right")
            assertTrue(events.isEmpty())
        }
    }

    @Test fun cancelBeforeActivationSuppressesAllTouchEntryPointsUntilFreshDown() {
        for (bothSides in listOf(false, true)) {
            val row = row(bothSides = bothSides, key = "touch-$bothSides")
            events.clear()
            motion(MotionEvent.ACTION_DOWN, 200f, 10f).useEvent { row.onTouchEvent(it) }
            row.cancelGesture()
            motion(MotionEvent.ACTION_MOVE, 100f, 10f).useEvent {
                assertFalse(row.onInterceptTouchEvent(it))
                assertTrue(row.onTouchEvent(it))
                assertTrue(row.dispatchTouchEvent(it))
            }
            motion(MotionEvent.ACTION_UP, 100f, 10f).useEvent { assertTrue(row.dispatchTouchEvent(it)) }
            motion(MotionEvent.ACTION_MOVE, 50f, 10f).useEvent { assertTrue(row.onTouchEvent(it)) }
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertTrue(events.isEmpty())
            motion(MotionEvent.ACTION_DOWN, 200f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_MOVE, 150f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_MOVE, 50f, 10f).useEvent { row.onTouchEvent(it) }
            assertEquals(-100f, row.getChildAt(row.childCount - 1).translationX, .01f)
            assertEquals(1, named("onSwipeStart").size)
            row.cancelGesture()
        }
    }

    @Test fun cancelAfterTouchActivationCannotReactivateAcrossZeroOrComplete() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 10f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 50f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 150f, 10f).useEvent { row.onTouchEvent(it) }
        assertEquals(100f, content(row).translationX, .01f)
        events.clear()
        row.cancelGesture()
        motion(MotionEvent.ACTION_MOVE, -200f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_UP, -200f, 10f).useEvent { row.onTouchEvent(it) }
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        consumeCancellation("row", "left")
        assertTrue(events.isEmpty())
    }

    @Test fun cancelFromSwipeStartDoesNotScheduleMoreGestureWork() {
        for (bothSides in listOf(false, true)) {
            val row = row(bothSides = bothSides, key = "start-$bothSides")
            events.clear()
            eventObserver = { name, _ -> if (name == "onSwipeStart") row.cancelGesture() }
            row.handleGestureStart()
            row.handleGestureUpdate(-120f, 0f)
            row.handleGestureEnd(-120f, 0f)
            settle()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(6))
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertEquals(1, named("onSwipeStart").size)
            assertTrue(named("onSwipeProgress").isEmpty())
            assertTrue(named("onSwipeStateChange").isEmpty())
            assertTrue(ends().isEmpty())
            eventObserver = null
        }
    }

    @Test fun cancelFromActionsNeededDoesNotRestartOpening() {
        val row = row()
        eventObserver = { name, _ -> if (name == "onActionsNeeded") row.cancelGesture() }
        row.open(SwipeSide.LEFT)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertEquals(listOf("onActionsNeeded"), events.map { it.first })
    }

    @Test fun cancelFromReleaseStateChangeDoesNotOpenOrAutoClose() {
        val row = row()
        row.autoClose = true
        row.handleGestureStart()
        row.handleGestureUpdate(40f, 0f)
        events.clear()
        eventObserver = { name, _ -> if (name == "onSwipeStateChange") row.cancelGesture() }
        row.handleGestureEnd(120f, 0f)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        consumeCancellation("row", "left")
        assertEquals(listOf("onSwipeStateChange"), events.map { it.first })
    }

    @Test fun cancelAtZeroTranslationStopsOpeningSpringInSingleAndBothSideConfigurations() {
        for (bothSides in listOf(false, true)) {
            val key = "spring-$bothSides"
            val row = row(bothSides = bothSides, key = key)
            row.open()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            events.clear()
            row.cancelGesture()
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertFalse(SwipeableView.isOpenByKey(key))
            assertTrue(events.isEmpty())
        }
    }

    @Test fun cancelOppositeSideTransitionDropsContinuationAndCompletion() {
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.open(SwipeSide.RIGHT)
        row.cancelGesture()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertTrue(events.isEmpty())
    }

    @Test fun cancelDropsPendingAutoCloseWithoutOpenIntentCompletion() {
        val row = row()
        row.autoClose = true
        row.autoCloseTimeout = 1000f
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        events.clear()
        row.cancelGesture()
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        consumeCancellation("row", "left")
        assertTrue(events.isEmpty())
    }

    @Test fun cancelPendingKeyRestoreDoesNotMountActionsOrEmitRestorationProgress() {
        val original = row(key = "cached")
        original.open(SwipeSide.LEFT)
        settle()
        root.removeView(original)
        events.clear()
        val restored = SwipeableView(activity, mockk<AppContext>(relaxed = true))
        restored.recyclingKey = "cached"
        restored.leftActionsWidth = 95f
        restored.rightActionsWidth = 130f
        restored.cancelGesture()
        repeat(3) { restored.addView(FrameLayout(activity)) }
        root.addView(restored)
        restored.layout(0, 0, 400, 64)
        settle()
        assertEquals(0f, content(restored).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("cached"))
        assertTrue(events.isEmpty())
    }

    @Test fun staticAndRawCancelExecuteAfterQueuedOpenInSingleAndBothSideConfigurations() {
        for (bothSides in listOf(false, true)) {
            for (raw in listOf(false, true)) {
                val key = "fifo-$bothSides-$raw"
                val row = row(bothSides = bothSides, key = key)
                events.clear()
                if (raw) {
                    row.postCommand { row.open() }
                    row.postCommand { row.cancelGesture() }
                } else {
                    SwipeableView.openByKey(key)
                    SwipeableView.cancelByKey(key)
                }
                settle()
                assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
                assertFalse(SwipeableView.isOpenByKey(key))
                assertTrue(ends().isEmpty())
            }
        }
    }

    @Test fun staticAndRawCancelDoNotInvalidateFollowingOpenInSingleAndBothSideConfigurations() {
        for (bothSides in listOf(false, true)) {
            for (raw in listOf(false, true)) {
                val key = "fifo-$bothSides-$raw"
                val row = row(bothSides = bothSides, key = key)
                events.clear()
                if (raw) {
                    row.postCommand { row.cancelGesture() }
                    row.postCommand { row.open() }
                } else {
                    SwipeableView.cancelByKey(key)
                    SwipeableView.openByKey(key)
                }
                settle()
                assertEquals(if (bothSides) -240f else -160f, row.getChildAt(row.childCount - 1).translationX, .01f)
                assertTrue(SwipeableView.isOpenByKey(key))
                assertEquals(listOf("open:right"), ends())
            }
        }
    }

    @Test fun queuedCancelCannotAffectReboundOrRoundTripReboundItem() {
        for (roundTrip in listOf(false, true)) {
            val row = row(key = "a")
            SwipeableView.cancelByKey("a")
            row.postCommand { row.cancelGesture() }
            row.recyclingKey = "b"
            if (roundTrip) row.recyclingKey = "a"
            row.applyPendingConfiguration()
            events.clear()
            row.open(SwipeSide.RIGHT)
            settle()
            assertEquals(-240f, content(row).translationX, .01f)
            assertEquals("right", SwipeableView.getOpenSideByKey(if (roundTrip) "a" else "b"))
            assertEquals(listOf("open:right"), ends())
            root.removeView(row)
            SwipeableView.clearCache()
        }
    }

    @Test fun queuedCancelCannotAffectSupersededRegistryOwner() {
        val old = row(key = "shared")
        old.open(SwipeSide.LEFT)
        settle()
        SwipeableView.cancelByKey("shared")
        old.postCommand { old.cancelGesture() }
        val replacement = row(key = "shared")
        replacement.open(SwipeSide.RIGHT)
        settle()
        assertEquals(160f, content(old).translationX, .01f)
        assertEquals(-240f, content(replacement).translationX, .01f)
        assertEquals("right", SwipeableView.getOpenSideByKey("shared"))
    }

    @Test fun queuedCancelCannotSurviveDetachAndReattach() {
        for (keyed in listOf(false, true)) {
            val row = row()
            row.open(SwipeSide.LEFT)
            settle()
            events.clear()
            if (keyed) SwipeableView.cancelByKey("row")
            row.postCommand { row.cancelGesture() }
            root.removeView(row)
            root.addView(row)
            settle()
            // A keyed cancel clears the cached open intent at command time, like a keyed close.
            assertEquals("keyed=$keyed", if (keyed) 0f else 160f, content(row).translationX, .01f)
            assertEquals("keyed=$keyed", if (keyed) null else "left", SwipeableView.getOpenSideByKey("row"))
            assertTrue("keyed=$keyed", ends().isEmpty())
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun rawCancelWithoutKeyPreservesCommandOrdering() {
        val row = row()
        row.recyclingKey = null
        row.applyPendingConfiguration()
        row.postCommand { row.open(SwipeSide.LEFT) }
        row.postCommand { row.cancelGesture() }
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertTrue(ends().isEmpty())
        row.postCommand { row.cancelGesture() }
        row.postCommand { row.open(SwipeSide.RIGHT) }
        settle()
        assertEquals(-240f, content(row).translationX, .01f)
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun cancelHidesReactRailsAndFreshDownStillAllowsActionPress() {
        val row = reactRow()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        row.cancelGesture()
        val left = row.getChildAt(0) as ReactViewGroup
        val right = row.getChildAt(1) as ReactViewGroup
        assertHidden(left)
        assertHidden(right)
        assertEquals(PointerEvents.NONE, left.pointerEvents)
        assertEquals(PointerEvents.NONE, right.pointerEvents)
        assertTrue(events.isEmpty())
        row.open(SwipeSide.RIGHT)
        settle()
        var presses = 0
        right.getChildAt(0).setOnClickListener { presses++ }
        tapReactTarget(row, right.getChildAt(0), 280f)
        assertEquals(1, presses)
        assertEquals(PointerEvents.AUTO, right.pointerEvents)
        assertEquals(PointerEvents.NONE, left.pointerEvents)
    }

    @Test fun singleSideSettledWidthChangeKeepsSideWithoutSyntheticCallbacks() {
        for (position in listOf("left", "right")) {
            val row = row(bothSides = false, key = "width-$position")
            if (position == "left") {
                row.leftActionsWidth = 80f
                row.rightActionsWidth = 0f
            }
            row.applyPendingConfiguration()
            row.open()
            settle()
            events.clear()
            if (position == "left") row.leftActionsWidth = 95f else row.rightActionsWidth = 95f
            row.applyPendingConfiguration()
            val target = if (position == "left") 190f else -190f
            assertEquals(target, content(row).translationX, .01f)
            assertEquals(0f, row.getChildAt(if (position == "left") 0 else 1).translationX, 0f)
            assertTrue(named("onSwipeProgress").isEmpty())
            assertTrue(named("onSwipeStart").isEmpty())
            assertTrue(ends().isEmpty())
            assertTrue(SwipeableView.isOpenByKey("width-$position"))
            assertEquals(position, SwipeableView.getOpenSideByKey("width-$position"))
        }
    }

    @Test fun singleSideSettledWidthChangeWaitsForMissingSlotsWithoutSyntheticStart() {
        val row = row(bothSides = false, children = false)
        row.open()
        settle()
        events.clear()
        row.rightActionsWidth = 95f
        row.applyPendingConfiguration()
        assertTrue(named("onSwipeStart").isEmpty())
        assertTrue(named("onSwipeProgress").isEmpty())
        assertTrue(ends().isEmpty())
        repeat(3) { row.addView(FrameLayout(activity)) }
        assertEquals(-190f, content(row).translationX, .01f)
        assertEquals(listOf(mapOf("side" to "right", "recyclingKey" to "row")), named("onActionsNeeded"))
        assertTrue(named("onSwipeStart").isEmpty())
    }

    @Test fun systemCancelNotifiesInternalGateAndNextGestureStartsNormally() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 100f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 140f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 240f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_CANCEL, 240f, 10f).useEvent { row.onTouchEvent(it) }
        assertEquals(listOf(mapOf("side" to "left", "recyclingKey" to "row")), named("onGestureCancelled"))
        assertTrue(ends().isEmpty())
        assertEquals(0f, content(row).translationX, 0f)
        motion(MotionEvent.ACTION_DOWN, 300f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 250f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 100f, 10f).useEvent { row.onTouchEvent(it) }
        assertEquals(2, named("onSwipeStart").size)
        assertEquals(listOf(
            mapOf("side" to "left", "recyclingKey" to "row"),
            mapOf("side" to "right", "recyclingKey" to "row")
        ), named("onSwipeStart"))
        motion(MotionEvent.ACTION_UP, 100f, 10f).useEvent { row.onTouchEvent(it) }
        settle()
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun widthChangeConsumesTouchUntilFreshDownInsteadOfRelatchingAcrossZero() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 200f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 240f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 340f, 10f).useEvent { row.onTouchEvent(it) }
        row.leftActionsWidth = 100f
        row.applyPendingConfiguration()
        assertEquals(1, named("onGestureCancelled").size)
        motion(MotionEvent.ACTION_MOVE, 50f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_UP, 50f, 10f).useEvent { row.onTouchEvent(it) }
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("row"))
        assertEquals(1, named("onSwipeStart").size)
        assertTrue(ends().isEmpty())
        motion(MotionEvent.ACTION_DOWN, 300f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 250f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 100f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_UP, 100f, 10f).useEvent { row.onTouchEvent(it) }
        settle()
        assertEquals("right", SwipeableView.getOpenSideByKey("row"))
        assertEquals(listOf("open:right"), ends())
    }

    @Test fun argumentlessStaticAndRawOpensUseRightFirstOrOnlyEnabledSide() {
        for (side in SwipeSide.values()) for (raw in listOf(false, true)) {
            val key = "default-${side.value}-$raw"
            val row = row(key = key)
            if (side == SwipeSide.LEFT) row.rightActionsWidth = 0f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(-side.sign * 120f, 0f)
            if (raw) row.postCommand { row.open() } else SwipeableView.openByKey(key)
            settle()
            assertEquals(side.value, SwipeableView.getOpenSideByKey(key))
            assertEquals(side.sign * if (side == SwipeSide.LEFT) 160f else 240f, content(row).translationX, .01f)
            assertEquals("open:${side.value}", ends().last())
            row.close(false)
        }
    }

    @Test fun widthUpdatesPreserveAutoCloseDeadlineAndExactlyOneCompletion() {
        for (side in SwipeSide.values()) {
            val row = row(key = "deadline-${side.value}")
            row.autoClose = true
            row.autoCloseTimeout = 10000f
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 160f, 0f)
            row.handleGestureEnd(side.sign * 160f, 0f)
            // Reconcile once before the opening spring advances, then while waiting.
            row.leftActionsWidth = 100f
            row.rightActionsWidth = 150f
            row.applyPendingConfiguration()
            settle() // 3.2 seconds
            row.leftActionsWidth = 110f
            row.rightActionsWidth = 160f
            row.applyPendingConfiguration()
            settle() // 6.4 seconds
            assertTrue(ends().isEmpty())
            assertEquals(side.value, SwipeableView.getOpenSideByKey("deadline-${side.value}"))
            repeat(300) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
            // 11.2 seconds: a restarted 10-second timer would still be waiting.
            assertEquals(listOf("open:${side.value}"), ends())
            assertEquals(0f, content(row).translationX, 0f)
            assertNull(SwipeableView.getOpenSideByKey("deadline-${side.value}"))
            events.clear()
            root.removeView(row)
        }
    }

    @Test fun widthChangeDuringAutoCloseAnimationKeepsOriginalCompletionSide() {
        val row = row()
        row.autoClose = true
        row.autoCloseTimeout = 4000f
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        repeat(252) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
        assertFalse(SwipeableView.isOpenByKey("row"))
        assertTrue(ends().isEmpty())
        row.leftActionsWidth = 95f
        row.applyPendingConfiguration()
        settle()
        assertEquals(listOf("open:left"), ends())
        assertEquals(0f, content(row).translationX, 0f)
    }

    @Test fun widthChangeDuringReleasedGestureSettleCancelsOnlyInternalCompletion() {
        for (side in SwipeSide.values()) for (opening in listOf(true, false)) {
            val key = "settling-${side.value}-$opening"
            val row = row(key = key)
            if (!opening) {
                row.open(side)
                settle()
            }
            events.clear()
            val translation = side.sign * if (opening) 120f else -160f
            row.handleGestureStart()
            row.handleGestureUpdate(translation, 0f)
            row.handleGestureEnd(translation, 0f)
            assertEquals(1, named("onSwipeStart").size)
            assertTrue(ends().isEmpty())
            row.leftActionsWidth = 95f
            row.rightActionsWidth = 140f
            row.applyPendingConfiguration()
            assertEquals(listOf(mapOf("recyclingKey" to key, "side" to side.value)), named("onGestureCancelled"))
            settle()
            assertTrue(ends().isEmpty())
            row.leftActionsWidth = 100f
            row.applyPendingConfiguration()
            assertEquals(1, named("onGestureCancelled").size)
            row.close(false)
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 160f, 0f)
            row.handleGestureEnd(side.sign * 160f, 0f)
            settle()
            assertEquals(2, named("onSwipeStart").size)
            assertEquals(listOf("open:${side.value}"), ends())
            row.rightActionsWidth = 150f
            row.applyPendingConfiguration()
            assertEquals(1, named("onGestureCancelled").size)
            root.removeView(row)
        }
    }

    @Test fun widthChangeDuringProgrammaticSettleDoesNotInventGestureCancellation() {
        val row = row()
        row.open(SwipeSide.LEFT)
        row.leftActionsWidth = 95f
        row.applyPendingConfiguration()
        settle()
        assertTrue(named("onGestureCancelled").isEmpty())
        assertTrue(ends().isEmpty())
    }

    @Test fun widthChangesRetainAutoCloseOwnershipUntilItsRealCompletionOrRemoval() {
        for (removeSide in listOf(false, true)) {
            val row = row(key = "auto-owner-$removeSide")
            row.autoClose = true
            row.autoCloseTimeout = 1000f
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            row.leftActionsWidth = if (removeSide) 0f else 95f
            row.applyPendingConfiguration()
            assertEquals(if (removeSide) 1 else 0, named("onGestureCancelled").size)
            settle()
            assertEquals(if (removeSide) emptyList<String>() else listOf("open:left"), ends())
            root.removeView(row)
            events.clear()
        }
    }

    @Test fun finalReviewRebindConsumesHeldPointerUntilFreshDown() {
        for (activated in listOf(false, true)) for (bothSides in listOf(false, true)) {
            val row = row(bothSides = bothSides, key = "old")
            motion(MotionEvent.ACTION_DOWN, 300f, 10f).useEvent { row.onTouchEvent(it) }
            if (activated) {
                motion(MotionEvent.ACTION_MOVE, 260f, 10f).useEvent { row.onTouchEvent(it) }
                motion(MotionEvent.ACTION_MOVE, 160f, 10f).useEvent { row.onTouchEvent(it) }
                assertEquals(-100f, content(row).translationX, .01f)
            }
            row.recyclingKey = "replacement"
            row.applyPendingConfiguration()
            events.clear()
            motion(MotionEvent.ACTION_MOVE, 100f, 10f).useEvent {
                assertFalse(row.onInterceptTouchEvent(it))
                assertTrue(row.onTouchEvent(it))
                assertTrue(row.dispatchTouchEvent(it))
            }
            motion(MotionEvent.ACTION_UP, 100f, 10f).useEvent { row.dispatchTouchEvent(it) }
            settle()
            assertEquals(0f, content(row).translationX, 0f)
            assertNull(SwipeableView.getOpenSideByKey("replacement"))
            assertTrue(events.isEmpty())
            motion(MotionEvent.ACTION_DOWN, 300f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_MOVE, 260f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_MOVE, 100f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_UP, 100f, 10f).useEvent { row.onTouchEvent(it) }
            settle()
            assertEquals(listOf(mapOf("side" to "right", "recyclingKey" to "replacement")), named("onSwipeStart"))
            assertEquals(listOf("open:right"), ends())
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun finalReviewSilentCommandsCancelOwnershipOnceAndAllowFreshGesture() {
        for (bothSides in listOf(false, true)) for (released in listOf(false, true)) {
            for (command in listOf("cancel", "close", "closeAll", "rawClose")) {
                val key = "silent-$bothSides-$released-$command"
                val row = row(bothSides = bothSides, key = key)
                row.autoClose = released
                row.autoCloseTimeout = 10000f
                row.handleGestureStart()
                row.handleGestureUpdate(-120f, 0f)
                if (released) row.handleGestureEnd(-120f, 0f)
                assertEquals(1, named("onSwipeStart").size)
                events.clear()
                when (command) {
                    "cancel" -> SwipeableView.cancelByKey(key)
                    "close" -> SwipeableView.closeByKey(key, false)
                    "closeAll" -> SwipeableView.closeAll(false)
                    else -> row.postCommand { row.close(false) }
                }
                settle()
                assertEquals(listOf(mapOf("side" to "right", "recyclingKey" to key)), named("onGestureCancelled"))
                assertTrue(ends().isEmpty())
                assertNull(SwipeableView.getOpenSideByKey(key))
                assertEquals(0f, content(row).translationX, 0f)
                row.handleGestureUpdate(240f, 0f)
                row.handleGestureEnd(240f, 1000f)
                row.cancelGesture()
                settle()
                assertEquals(1, named("onGestureCancelled").size)
                assertTrue(named("onSwipeStart").isEmpty())
                assertTrue(ends().isEmpty())
                row.autoClose = false
                row.handleGestureStart()
                row.handleGestureUpdate(-120f, 0f)
                row.handleGestureEnd(-120f, 0f)
                settle()
                assertEquals(1, named("onSwipeStart").size)
                assertEquals(listOf("open:right"), ends())
                assertEquals(1, named("onGestureCancelled").size)
                root.removeView(row)
                events.clear()
            }
        }
    }

    @Test fun finalReviewInstantCloseConsumesHeldTouchAndDoesNotInventCompletion() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 300f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 260f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_MOVE, 160f, 10f).useEvent { row.onTouchEvent(it) }
        row.close(false)
        motion(MotionEvent.ACTION_MOVE, 400f, 10f).useEvent { row.onTouchEvent(it) }
        motion(MotionEvent.ACTION_UP, 400f, 10f).useEvent { row.onTouchEvent(it) }
        settle()
        assertEquals(1, named("onSwipeStart").size)
        assertEquals(listOf(mapOf("side" to "right", "recyclingKey" to "row")), named("onGestureCancelled"))
        assertTrue(ends().isEmpty())
        assertEquals(0f, content(row).translationX, 0f)
    }

    @Test fun finalReviewCloseAllSeesEarlierQueuedDefaultAndExplicitOpens() {
        for (bothSides in listOf(false, true)) for (explicit in listOf(false, true)) {
            val row = row(bothSides = bothSides, key = "queued")
            val side = if (bothSides && explicit) SwipeSide.LEFT else SwipeSide.RIGHT
            if (explicit) SwipeableView.openByKeyOnSide("queued", side) else SwipeableView.openByKey("queued")
            SwipeableView.closeAll()
            settle()
            assertEquals(0f, content(row).translationX, 0f)
            assertNull(SwipeableView.getOpenSideByKey("queued"))
            assertEquals(listOf("closed:${side.value}"), ends())
            assertTrue(named("onSwipeStart").isEmpty())
            root.removeView(row)
            events.clear()
        }
    }

    @Test fun finalReviewQueuedCloseAllCannotCloseReboundOrReplacementBinding() {
        for (replacementView in listOf(false, true)) {
            val old = row(key = "old")
            SwipeableView.openByKey("old")
            SwipeableView.closeAll()
            val replacement = if (replacementView) row(key = "old") else old.apply {
                recyclingKey = "new"
                recyclingKey = "old"
                applyPendingConfiguration()
            }
            replacement.open(SwipeSide.LEFT)
            settle()
            assertEquals(160f, content(replacement).translationX, .01f)
            assertEquals("left", SwipeableView.getOpenSideByKey("old"))
            assertEquals(listOf("open:left"), ends())
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun finalReviewUnboundCloseClearsCacheBeforeRemountWithoutDelayedMutation() {
        for (side in SwipeSide.values()) for (animated in listOf(false, true)) {
            val old = row(key = "cached")
            old.open(side)
            settle()
            root.removeView(old)
            assertEquals(side.value, SwipeableView.getOpenSideByKey("cached"))
            events.clear()
            SwipeableView.closeByKey("cached", animated)
            assertNull(SwipeableView.getOpenSideByKey("cached"))
            val replacement = row(key = "cached")
            assertEquals(0f, content(replacement).translationX, 0f)
            assertTrue(events.isEmpty())
            val opposite = if (side == SwipeSide.LEFT) SwipeSide.RIGHT else SwipeSide.LEFT
            replacement.open(opposite)
            settle()
            root.removeView(replacement)
            settle()
            assertEquals(opposite.value, SwipeableView.getOpenSideByKey("cached"))
            assertEquals(listOf("open:${opposite.value}"), ends())
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun finalReviewQueuedBoundCloseCannotClearReplacementIntent() {
        val old = row(key = "shared")
        old.open(SwipeSide.LEFT)
        settle()
        SwipeableView.closeByKey("shared", false)
        val replacement = row(key = "shared")
        replacement.open(SwipeSide.RIGHT)
        root.removeView(old)
        settle()
        assertEquals("right", SwipeableView.getOpenSideByKey("shared"))
        assertEquals(-240f, content(replacement).translationX, .01f)
    }

    @Test fun finalReviewStartPayloadCapturesOldKeyBeforeRebind() {
        val row = row(key = "old")
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        val queuedStart = named("onSwipeStart").single()
        row.recyclingKey = "replacement"
        row.applyPendingConfiguration()
        row.handleGestureStart()
        row.handleGestureUpdate(-120f, 0f)
        assertEquals(mapOf("side" to "left", "recyclingKey" to "old"), queuedStart)
        assertEquals(mapOf("side" to "right", "recyclingKey" to "replacement"), named("onSwipeStart").last())
    }

    @Test fun lifecycleReviewAnimatedCloseRetainsGestureUntilSilentInterruption() {
        for (bothSides in listOf(false, true)) for (released in listOf(false, true)) {
            for (cancel in listOf(false, true)) for (queued in listOf(false, true)) {
                val key = "close-owner-$bothSides-$released-$cancel-$queued"
                val row = row(bothSides = bothSides, key = key)
                row.handleGestureStart()
                row.handleGestureUpdate(-120f, 0f)
                if (released) row.handleGestureEnd(-120f, 0f)
                assertEquals(1, named("onSwipeStart").size)
                events.clear()
                if (queued) SwipeableView.closeByKey(key, true) else row.close(true)
                assertTrue(ends().isEmpty())
                assertTrue(named("onGestureCancelled").isEmpty())
                if (cancel) SwipeableView.cancelByKey(key) else SwipeableView.closeByKey(key, false)
                settle()
                assertEquals(listOf(mapOf("side" to "right", "recyclingKey" to key)), named("onGestureCancelled"))
                assertTrue(ends().isEmpty())
                assertEquals(0f, content(row).translationX, 0f)
                assertNull(SwipeableView.getOpenSideByKey(key))
                row.handleGestureStart()
                row.handleGestureUpdate(-120f, 0f)
                row.handleGestureEnd(-120f, 0f)
                settle()
                assertEquals(1, named("onSwipeStart").size)
                assertEquals(listOf("open:right"), ends())
                assertEquals(1, named("onGestureCancelled").size)
                root.removeView(row)
                events.clear()
            }
        }
    }

    @Test fun lifecycleReviewAnimatedCloseCompletesOwnershipAndDoesNotInventProgrammaticOwnership() {
        val row = row()
        row.open(SwipeSide.RIGHT)
        settle()
        events.clear()
        row.close(true)
        row.close(false)
        settle()
        assertTrue(named("onGestureCancelled").isEmpty())
        assertTrue(ends().isEmpty())
        row.handleGestureStart()
        row.handleGestureUpdate(-120f, 0f)
        row.close(true)
        settle()
        assertEquals(listOf("closed:right"), ends())
        assertTrue(named("onGestureCancelled").isEmpty())
        row.close(false)
        row.cancelGesture()
        assertTrue(named("onGestureCancelled").isEmpty())
        assertEquals(listOf("closed:right"), ends())
    }

    @Test fun lifecycleReviewUnboundCloseKeepsSameReattachedInstanceClosed() {
        for (bothSides in listOf(false, true)) for (side in SwipeSide.values()) {
            for (animated in listOf(false, true)) {
                val key = "reattach-$bothSides-${side.value}-$animated"
                val row = row(bothSides = bothSides, key = key)
                if (!bothSides && side == SwipeSide.LEFT) {
                    row.leftActionsWidth = 80f
                    row.rightActionsWidth = 0f
                    row.applyPendingConfiguration()
                }
                row.open(side)
                settle()
                root.removeView(row)
                assertEquals(side.value, SwipeableView.getOpenSideByKey(key))
                events.clear()
                SwipeableView.closeByKey(key, animated)
                assertNull(SwipeableView.getOpenSideByKey(key))
                root.addView(row, FrameLayout.LayoutParams(400, 64))
                settle()
                assertEquals(0f, content(row).translationX, 0f)
                assertNull(SwipeableView.getOpenSideByKey(key))
                assertHidden(row.getChildAt(0))
                assertHidden(row.getChildAt(1))
                assertTrue(events.isEmpty())
                row.handleGestureStart()
                row.handleGestureUpdate(side.sign * 120f, 0f)
                row.handleGestureEnd(side.sign * 120f, 0f)
                settle()
                assertEquals(listOf("open:${side.value}"), ends())
                assertEquals(side.value, SwipeableView.getOpenSideByKey(key))
                root.removeView(row)
                events.clear()
            }
        }
    }

    @Test fun lifecycleReviewReattachReadsReplacementCachedSide() {
        val original = row(key = "shared-reattach")
        original.open(SwipeSide.LEFT)
        settle()
        root.removeView(original)
        val replacement = row(key = "shared-reattach")
        replacement.open(SwipeSide.RIGHT)
        settle()
        root.removeView(replacement)
        events.clear()
        root.addView(original, FrameLayout.LayoutParams(400, 64))
        settle()
        assertEquals(-240f, content(original).translationX, .01f)
        assertEquals("right", SwipeableView.getOpenSideByKey("shared-reattach"))
        assertTrue(named("onSwipeStart").isEmpty())
        assertTrue(ends().isEmpty())
    }

    @Test fun nativeFollowupSameSideOpenThenSilentCommandNotifiesOriginalOwner() {
        for (side in SwipeSide.values()) for (released in listOf(false, true)) {
            for (automatic in listOf(false, true)) for (cancel in listOf(false, true)) {
                val key = "takeover-${side.value}-$released-$automatic-$cancel"
                val row = row(key = key)
                row.autoClose = automatic
                row.autoCloseTimeout = 10000f
                row.handleGestureStart()
                row.handleGestureUpdate(side.sign * 120f, 0f)
                if (released) row.handleGestureEnd(side.sign * 120f, 0f)
                SwipeableView.openByKeyOnSide(key, side)
                if (cancel) SwipeableView.cancelByKey(key) else SwipeableView.closeByKey(key, false)
                settle()
                assertEquals(listOf(mapOf("side" to side.value, "recyclingKey" to key)), named("onGestureCancelled"))
                assertEquals(1, named("onSwipeStart").size)
                assertTrue(ends().isEmpty())
                assertEquals(0f, content(row).translationX, 0f)
                row.cancelGesture()
                assertEquals(1, named("onGestureCancelled").size)
                row.autoClose = false
                row.handleGestureStart()
                row.handleGestureUpdate(side.sign * 120f, 0f)
                row.handleGestureEnd(side.sign * 120f, 0f)
                settle()
                assertEquals(2, named("onSwipeStart").size)
                assertEquals(listOf("open:${side.value}"), ends())
                root.removeView(row)
                events.clear()
            }
        }
    }

    @Test fun nativeFollowupOpenTakeoverCompletesOnceWithoutInventingProgrammaticCancellation() {
        for (side in SwipeSide.values()) {
            val row = row()
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 120f, 0f)
            row.handleGestureEnd(side.sign * 120f, 0f)
            row.open(side)
            settle()
            assertEquals(listOf("open:${side.value}"), ends())
            assertTrue(named("onGestureCancelled").isEmpty())
            row.close(false)
            row.open(side)
            row.cancelGesture()
            assertTrue(named("onGestureCancelled").isEmpty())
            root.removeView(row)
            events.clear()
        }
    }

    @Test fun nativeFollowupFreshGestureCancelsSettlementBeforeNewStart() {
        for (automatic in listOf(false, true)) {
            val row = row()
            row.autoClose = automatic
            row.autoCloseTimeout = 10000f
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            if (automatic) settle()
            row.handleGestureStart()
            row.handleGestureUpdate(-120f, 0f)
            assertEquals(listOf("onSwipeStart", "onGestureCancelled", "onSwipeStart"),
                events.map { it.first }.filter { it == "onSwipeStart" || it == "onGestureCancelled" })
            assertEquals(mapOf("side" to "left", "recyclingKey" to "row"), named("onGestureCancelled").single())
            row.cancelGesture()
            assertEquals(2, named("onGestureCancelled").size)
            assertTrue(ends().isEmpty())
            root.removeView(row)
            events.clear()
        }
    }

    @Test fun nativeFollowupSameInstanceDetachCancelsActiveReleasedAndWaitingOwnership() {
        for (phase in listOf("drag", "settle", "wait")) for (side in SwipeSide.values()) {
            val row = row(key = "same-instance")
            settle()
            assertTrue(row.isAttachedToWindow)
            row.autoClose = phase == "wait"
            row.autoCloseTimeout = 10000f
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 120f, 0f)
            if (phase != "drag") row.handleGestureEnd(side.sign * 120f, 0f)
            if (phase == "wait") settle()
            root.removeView(row)
            assertEquals(listOf(mapOf("side" to side.value, "recyclingKey" to "same-instance")), named("onGestureCancelled"))
            root.addView(row, FrameLayout.LayoutParams(400, 64))
            settle()
            // Pass the original 10-second deadline and any incorrectly restarted
            // deadline without permitting abandoned work to fabricate an end.
            repeat(700) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
            assertTrue(ends().isEmpty())
            row.close(false)
            row.autoClose = false
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 120f, 0f)
            row.handleGestureEnd(side.sign * 120f, 0f)
            settle()
            assertEquals(2, named("onSwipeStart").size)
            assertEquals(listOf("open:${side.value}"), ends())
            assertEquals(1, named("onGestureCancelled").size)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun nativeFollowupRebindAndContentRemovalNotifyCapturedOldOwner() {
        for (removeContent in listOf(false, true)) {
            val row = row(key = "old-binding")
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            if (removeContent) {
                row.removeView(content(row))
                row.addView(FrameLayout(activity))
            } else {
                row.recyclingKey = "new-binding"
                row.applyPendingConfiguration()
            }
            assertEquals(listOf(mapOf("side" to "left", "recyclingKey" to "old-binding")), named("onGestureCancelled"))
            row.close(false)
            row.handleGestureStart()
            row.handleGestureUpdate(-120f, 0f)
            assertEquals(2, named("onSwipeStart").size)
            assertTrue(ends().isEmpty())
            row.cancelGesture()
            root.removeView(row)
            events.clear()
        }
    }

    @Test fun nativeFollowupAnimatedCommandsConsumePhysicalSequenceUntilFreshDown() {
        for (dispatch in listOf(false, true)) for (side in SwipeSide.values()) {
            for (command in listOf("close", "closeAll", "staticClose", "open")) {
                val row = row()
                fun touch(action: Int, distance: Float) {
                    motion(action, 200f + side.sign * distance, 10f).useEvent {
                        if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                    }
                }
                touch(MotionEvent.ACTION_DOWN, 0f)
                touch(MotionEvent.ACTION_MOVE, 40f)
                touch(MotionEvent.ACTION_MOVE, 140f)
                assertEquals(side.sign * 100f, content(row).translationX, .01f)
                if (dispatch) assertTrue(nativeGestureStarts > 0)
                when (command) {
                    "close" -> row.close(true)
                    "closeAll" -> SwipeableView.closeAll(true)
                    "staticClose" -> SwipeableView.closeByKey("row", true)
                    else -> row.open(side)
                }
                shadowOf(Looper.getMainLooper()).idle()
                touch(MotionEvent.ACTION_MOVE, 180f)
                touch(MotionEvent.ACTION_MOVE, -200f)
                touch(MotionEvent.ACTION_UP, -200f)
                settle()
                assertEquals(1, named("onSwipeStart").size)
                assertEquals(listOf("${if (command == "open") "open" else "closed"}:${side.value}"), ends())
                assertTrue(named("onGestureCancelled").isEmpty())
                row.close(false)
                touch(MotionEvent.ACTION_DOWN, 0f)
                touch(MotionEvent.ACTION_MOVE, 40f)
                touch(MotionEvent.ACTION_MOVE, 180f)
                touch(MotionEvent.ACTION_UP, 180f)
                settle()
                assertEquals(2, named("onSwipeStart").size)
                assertEquals("open:${side.value}", ends().last())
                root.removeView(row)
                SwipeableView.clearCache()
                events.clear()
            }
        }
    }

    @Test fun stuckGestureWatchdogCancelsSilentlyAndConsumesHeldTouchUntilFreshDown() {
        for (dispatch in listOf(false, true)) for (side in SwipeSide.values()) {
            val row = row()
            settle()
            assertTrue(row.isAttachedToWindow)
            fun touch(action: Int, distance: Float) {
                motion(action, 200f + side.sign * distance, 10f).useEvent {
                    if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                }
            }
            touch(MotionEvent.ACTION_DOWN, 0f)
            touch(MotionEvent.ACTION_MOVE, 40f)
            touch(MotionEvent.ACTION_MOVE, 140f)
            assertEquals(side.sign * 100f, content(row).translationX, .01f)
            assertEquals(1, named("onSwipeStart").size)
            // Hold the finger down past the 5 s stuck-gesture watchdog.
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(5100))
            settle()
            assertEquals(0f, content(row).translationX, .01f)
            assertTrue(ends().isEmpty())
            consumeCancellation("row", side.value)
            // The same pointer keeps moving, then lifts: no new swipe and no fabricated release.
            touch(MotionEvent.ACTION_MOVE, 180f)
            touch(MotionEvent.ACTION_MOVE, 60f)
            touch(MotionEvent.ACTION_MOVE, 180f)
            touch(MotionEvent.ACTION_UP, 180f)
            settle()
            assertEquals(1, named("onSwipeStart").size)
            assertTrue(ends().isEmpty())
            assertTrue(named("onGestureCancelled").isEmpty())
            assertEquals(0f, content(row).translationX, .01f)
            // A fresh ACTION_DOWN starts a normal swipe again.
            touch(MotionEvent.ACTION_DOWN, 0f)
            touch(MotionEvent.ACTION_MOVE, 40f)
            touch(MotionEvent.ACTION_MOVE, 180f)
            touch(MotionEvent.ACTION_UP, 180f)
            settle()
            assertEquals(2, named("onSwipeStart").size)
            assertEquals(listOf("open:${side.value}"), ends())
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun cancelledGestureReportsTheSettledProgressAndState() {
        for (watchdog in listOf(false, true)) for (startOpen in listOf(false, true)) for (crossed in listOf(true, false)) {
            val case = "watchdog=$watchdog startOpen=$startOpen crossed=$crossed"
            val row = row()
            settle()
            if (startOpen) {
                row.open(SwipeSide.LEFT)
                settle()
            }
            events.clear()
            fun touch(action: Int, x: Float) {
                motion(action, x, 10f).useEvent { row.dispatchTouchEvent(it) }
            }
            // A closed row drags toward open, an open row toward closed.
            val direction = if (startOpen) -1f else 1f
            touch(MotionEvent.ACTION_DOWN, 200f)
            touch(MotionEvent.ACTION_MOVE, 200f + direction * 40f)
            touch(MotionEvent.ACTION_MOVE, 200f + direction * (if (crossed) 140f else 60f))
            // Let the frame callback report the mid-drag progress.
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(48))
            val midDrag = named("onSwipeProgress").last()["progress"] as Double
            assertTrue(case, midDrag > 0.0 && midDrag < 1.0)
            assertEquals(case, if (crossed) 1 else 0, named("onSwipeStateChange").size)
            val reported = events.size
            if (watchdog) {
                shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(5100))
            } else {
                touch(MotionEvent.ACTION_CANCEL, 200f + direction * 140f)
            }
            settle()
            val after = events.drop(reported)
            val settled = if (startOpen) "open" else "closed"
            assertEquals(case, if (startOpen) 160f else 0f, content(row).translationX, .01f)
            // The progress and state UIs end at the settled position, not mid-drag.
            assertEquals(case, listOf(mapOf(
                "progress" to (if (startOpen) 1.0 else 0.0),
                "translationX" to (if (startOpen) 160.0 else 0.0),
                "side" to "left",
                "recyclingKey" to "row"
            )), after.filter { it.first == "onSwipeProgress" }.map { it.second })
            assertEquals(
                case,
                if (crossed) listOf(mapOf("state" to settled, "side" to "left", "recyclingKey" to "row")) else emptyList(),
                after.filter { it.first == "onSwipeStateChange" }.map { it.second }
            )
            // A cancel never completes the swipe.
            assertTrue(case, ends().isEmpty())
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun cancelledDragOfAnOpenAutoCloseRowStillAutoCloses() {
        for (watchdog in listOf(false, true)) {
            val case = "watchdog=$watchdog"
            val row = row()
            settle()
            row.autoClose = true
            row.autoCloseTimeout = 4000f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            settle()
            assertEquals(case, 160f, content(row).translationX, .01f)
            fun touch(action: Int, x: Float) {
                motion(action, x, 10f).useEvent { row.dispatchTouchEvent(it) }
            }
            // A drag of the waiting row takes over the release's completion.
            touch(MotionEvent.ACTION_DOWN, 200f)
            touch(MotionEvent.ACTION_MOVE, 160f)
            touch(MotionEvent.ACTION_MOVE, 150f)
            assertEquals(2, named("onSwipeStart").size)
            assertEquals(case, 1, named("onGestureCancelled").size)
            if (watchdog) {
                shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(5100))
            } else {
                touch(MotionEvent.ACTION_CANCEL, 150f)
            }
            settle()
            assertEquals(case, 160f, content(row).translationX, .01f)
            assertTrue(case, ends().isEmpty())
            // The cancel restarts the wait, and the auto-close completes the drag.
            repeat(2) { settle() }
            assertEquals(case, 0f, content(row).translationX, .01f)
            assertEquals(case, listOf("open:left"), ends())
            assertEquals(case, 1, named("onGestureCancelled").size)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun nativeFollowupPhysicalDragInterruptsSettlementAndDetachConsumesHeldTouch() {
        for (dispatch in listOf(false, true)) {
            val row = row()
            settle()
            assertTrue(row.isAttachedToWindow)
            fun touch(action: Int, x: Float) {
                motion(action, x, 10f).useEvent {
                    if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                }
            }
            row.handleGestureStart()
            row.handleGestureUpdate(-120f, 0f)
            row.handleGestureEnd(-120f, 0f)
            touch(MotionEvent.ACTION_DOWN, 300f)
            assertEquals(0, named("onGestureCancelled").size)
            touch(MotionEvent.ACTION_MOVE, 260f)
            assertEquals(1, named("onGestureCancelled").size)
            touch(MotionEvent.ACTION_MOVE, 160f)
            assertEquals(2, named("onSwipeStart").size)
            root.removeView(row)
            root.addView(row, FrameLayout.LayoutParams(400, 64))
            touch(MotionEvent.ACTION_MOVE, 50f)
            touch(MotionEvent.ACTION_UP, 50f)
            settle()
            assertEquals(2, named("onSwipeStart").size)
            assertEquals(2, named("onGestureCancelled").size)
            assertTrue(ends().isEmpty())
            row.close(false)
            touch(MotionEvent.ACTION_DOWN, 300f)
            touch(MotionEvent.ACTION_MOVE, 260f)
            touch(MotionEvent.ACTION_MOVE, 100f)
            touch(MotionEvent.ACTION_UP, 100f)
            settle()
            assertEquals(3, named("onSwipeStart").size)
            assertEquals(listOf("open:right"), ends())
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun nativeFollowupCancellationCallbackCannotOverwriteReentrantGestureOwner() {
        val row = row(key = "old")
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        eventObserver = { name, body ->
            if (name == "onGestureCancelled" && body["recyclingKey"] == "old") {
                row.recyclingKey = "new"
                row.applyPendingConfiguration()
                row.handleGestureStart()
                row.handleGestureUpdate(-120f, 0f)
            }
        }
        row.handleGestureStart()
        eventObserver = null
        assertEquals("new", row.recyclingKey)
        assertEquals(listOf("left", "right"), named("onSwipeStart").map { it["side"] })
        row.handleGestureEnd(-120f, 0f)
        settle()
        assertEquals(listOf("open:right"), ends())
        assertEquals(listOf(mapOf("side" to "left", "recyclingKey" to "old")), named("onGestureCancelled"))
    }

    @Test fun nativeFollowupOppositeOpenAtZeroCompletesOriginalPhysicalSideFirst() {
        for (side in SwipeSide.values()) {
            val row = row()
            motion(MotionEvent.ACTION_DOWN, 200f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_MOVE, 200f + side.sign * 40f, 10f).useEvent { row.onTouchEvent(it) }
            assertEquals(0f, content(row).translationX, 0f)
            assertEquals(listOf(side.value), named("onSwipeStart").map { it["side"] })
            val opposite = if (side == SwipeSide.LEFT) SwipeSide.RIGHT else SwipeSide.LEFT
            row.open(opposite)
            motion(MotionEvent.ACTION_MOVE, 200f + side.sign * 180f, 10f).useEvent { row.onTouchEvent(it) }
            motion(MotionEvent.ACTION_UP, 200f + side.sign * 180f, 10f).useEvent { row.onTouchEvent(it) }
            settle()
            assertEquals(listOf("closed:${side.value}", "open:${opposite.value}"), ends())
            assertEquals(1, named("onSwipeStart").size)
            assertTrue(named("onGestureCancelled").isEmpty())
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun nativeFollowupReentrantCancellationDoesNotAbortRebindOrChildRemoval() {
        for (removeContent in listOf(false, true)) {
            val row = row(key = "old")
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            val removed = content(row)
            eventObserver = { name, _ -> if (name == "onGestureCancelled") row.close(false) }
            if (removeContent) row.removeView(removed) else row.recyclingKey = "new"
            eventObserver = null
            val key = if (removeContent) "old" else "new"
            assertEquals(key, row.recyclingKey)
            assertEquals(listOf(mapOf("side" to "left", "recyclingKey" to "old")), named("onGestureCancelled"))
            if (removeContent) row.addView(FrameLayout(activity))
            SwipeableView.openByKeyOnSide(key, SwipeSide.RIGHT)
            settle()
            assertEquals(-240f, content(row).translationX, .01f)
            assertEquals("right", SwipeableView.getOpenSideByKey(key))
            assertEquals(listOf("open:right"), ends())
            if (removeContent) assertEquals(120f, removed.translationX, .01f)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun nativeFollowupReattachDoesNotInventAutoCloseForProgrammaticOpen() {
        val row = row()
        row.autoClose = true
        row.autoCloseTimeout = 1000f
        row.open(SwipeSide.LEFT)
        settle()
        root.removeView(row)
        root.addView(row, FrameLayout.LayoutParams(400, 64))
        settle()
        assertEquals(160f, content(row).translationX, .01f)
        assertEquals("left", SwipeableView.getOpenSideByKey("row"))
        assertTrue(ends().isEmpty())
        assertTrue(named("onGestureCancelled").isEmpty())
    }

    @Test fun contentReplacementDuringClosedRowDragRestoresClosedGeometry() {
        val row = row(key = "content-replacement")
        settle()
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        assertEquals(120f, content(row).translationX, .01f)
        assertNull(SwipeableView.getOpenSideByKey("content-replacement"))

        row.removeView(content(row))
        val replacement = FrameLayout(activity)
        row.addView(replacement)
        row.layout(0, 0, 400, 64)
        settle()

        assertSame(replacement, content(row))
        assertNull(SwipeableView.getOpenSideByKey("content-replacement"))
        assertHidden(row.getChildAt(0))
        assertHidden(row.getChildAt(1))
        assertEquals(listOf(mapOf("side" to "left", "recyclingKey" to "content-replacement")),
            named("onGestureCancelled"))
        assertTrue(ends().isEmpty())
        assertEquals("Replacement content must match the logically closed row", 0f, replacement.translationX, .01f)
    }

    @Test fun tapDuringAutoCloseWaitKeepsTheTimerAndItsOpenCompletion() {
        for (dispatch in listOf(false, true)) {
            val row = row()
            settle()
            row.autoClose = true
            row.autoCloseTimeout = 5000f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            settle()
            assertEquals(160f, content(row).translationX, .01f)
            assertTrue(ends().isEmpty())
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                motion(action, 200f, 10f).useEvent {
                    if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                }
            }
            repeat(3) { settle() }
            assertTrue(named("onGestureCancelled").isEmpty())
            assertEquals(listOf("open:left"), ends())
            assertEquals(0f, content(row).translationX, 0f)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun tapDuringReleaseSnapOpenKeepsTheAutoCloseTimer() {
        for (dispatch in listOf(false, true)) {
            val row = row()
            settle()
            row.autoClose = true
            row.autoCloseTimeout = 5000f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16))
            assertTrue(content(row).translationX < 160f)
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                motion(action, 200f, 10f).useEvent {
                    if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                }
            }
            settle()
            assertEquals(160f, content(row).translationX, .01f)
            assertTrue(ends().isEmpty())
            repeat(3) { settle() }
            assertTrue(named("onGestureCancelled").isEmpty())
            assertEquals(listOf("open:left"), ends())
            assertEquals(0f, content(row).translationX, 0f)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun tapDuringAutoCloseClosingSpringKeepsItsOpenCompletion() {
        for (dispatch in listOf(false, true)) {
            val row = row()
            settle()
            row.autoClose = true
            row.autoCloseTimeout = 1000f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(120f, 0f)
            row.handleGestureEnd(120f, 0f)
            var reachedOpen = false
            for (frame in 0 until 200) {
                shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16))
                val x = content(row).translationX
                if (x >= 159.99f) reachedOpen = true
                if (reachedOpen && x < 150f) break
            }
            val closingAt = content(row).translationX
            assertTrue(reachedOpen && closingAt > 0f && closingAt < 150f)
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                motion(action, 200f, 10f).useEvent {
                    if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                }
            }
            settle()
            assertTrue(named("onGestureCancelled").isEmpty())
            assertEquals(listOf("open:left"), ends())
            assertEquals(0f, content(row).translationX, 0f)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun tapNeverInterruptsASettlingAnimation() {
        for (dispatch in listOf(false, true)) {
            for (phase in listOf("releaseOpen", "releaseClose", "programmaticOpen", "programmaticClose")) {
                val label = "$phase dispatch=$dispatch"
                val row = row()
                settle()
                if (phase == "releaseClose" || phase == "programmaticClose") {
                    row.open(SwipeSide.LEFT)
                    settle()
                    events.clear()
                }
                when (phase) {
                    "releaseOpen" -> {
                        row.handleGestureStart()
                        row.handleGestureUpdate(120f, 0f)
                        row.handleGestureEnd(120f, 0f)
                    }
                    "releaseClose" -> {
                        row.handleGestureStart()
                        row.handleGestureUpdate(-120f, 0f)
                        row.handleGestureEnd(-120f, 0f)
                    }
                    "programmaticOpen" -> row.open(SwipeSide.LEFT)
                    "programmaticClose" -> row.close()
                }
                // A programmatic spring starts at the edge. Tap only once it is in flight.
                for (frame in 0 until 10) {
                    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16))
                    val x = content(row).translationX
                    if (x > 0f && x < 160f) break
                }
                val opening = phase.endsWith("Open")
                val target = if (opening) 160f else 0f
                val midway = content(row).translationX
                assertTrue(label, midway > 0f && midway < 160f && midway != target)
                for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                    motion(action, 200f, 10f).useEvent {
                        if (dispatch) row.dispatchTouchEvent(it) else row.onTouchEvent(it)
                    }
                }
                settle()
                assertEquals(label, target, content(row).translationX, .01f)
                assertEquals(label, listOf(if (opening) "open:left" else "closed:left"), ends())
                assertTrue(label, named("onGestureCancelled").isEmpty())
                assertEquals(label, if (opening) "left" else null, SwipeableView.getOpenSideByKey("row"))
                root.removeView(row)
                SwipeableView.clearCache()
                events.clear()
            }
        }
    }

    @Test fun rebindDuringAutoCloseWaitRestoresTheOldKeyClosed() {
        for (side in SwipeSide.values()) {
            val row = row(key = "auto-wait")
            settle()
            row.autoClose = true
            row.autoCloseTimeout = 10000f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 120f, 0f)
            row.handleGestureEnd(side.sign * 120f, 0f)
            settle()
            assertEquals(side.value, SwipeableView.getOpenSideByKey("auto-wait"))
            row.recyclingKey = "other"
            row.applyPendingConfiguration()
            assertNull(SwipeableView.getOpenSideByKey("auto-wait"))
            row.recyclingKey = "auto-wait"
            repeat(5) { settle() }
            assertEquals(0f, content(row).translationX, 0f)
            assertNull(SwipeableView.getOpenSideByKey("auto-wait"))
            assertTrue(ends().isEmpty())
            assertEquals(1, named("onGestureCancelled").size)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun detachDuringAutoCloseWaitReattachesClosedWithoutCompletion() {
        for (side in SwipeSide.values()) {
            val row = row(key = "auto-wait")
            settle()
            row.autoClose = true
            row.autoCloseTimeout = 10000f
            row.applyPendingConfiguration()
            row.handleGestureStart()
            row.handleGestureUpdate(side.sign * 120f, 0f)
            row.handleGestureEnd(side.sign * 120f, 0f)
            settle()
            assertEquals(side.value, SwipeableView.getOpenSideByKey("auto-wait"))
            root.removeView(row)
            root.addView(row, FrameLayout.LayoutParams(400, 64))
            repeat(5) { settle() }
            assertEquals(0f, content(row).translationX, 0f)
            assertNull(SwipeableView.getOpenSideByKey("auto-wait"))
            assertTrue(ends().isEmpty())
            assertEquals(1, named("onGestureCancelled").size)
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun closingAnAlreadyClosedRowReportsNoSide() {
        for (bothSides in listOf(true, false)) {
            val row = row(bothSides = bothSides)
            settle()
            row.close(true)
            settle()
            assertEquals(listOf(mapOf("state" to "closed", "recyclingKey" to "row")), named("onSwipeEnd"))
            root.removeView(row)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun gestureDisabledRowsRestoreTheCachedOpenSide() {
        for (side in SwipeSide.values()) {
            val row = row(key = "disabled-restore")
            row.gestureEnabled = false
            row.applyPendingConfiguration()
            row.open(side)
            settle()
            val openX = side.sign * (if (side == SwipeSide.LEFT) 160f else 240f)
            // Recycled instance: rebind away and back while gestures stay disabled.
            row.recyclingKey = "other"
            row.applyPendingConfiguration()
            row.recyclingKey = "disabled-restore"
            row.applyPendingConfiguration()
            settle()
            assertEquals(openX, content(row).translationX, .01f)
            root.removeView(row)
            // New instance: its first gestureEnabled=false prop is not a disable of this row.
            val fresh = SwipeableView(activity, mockk<AppContext>(relaxed = true))
            fresh.gestureEnabled = false
            fresh.recyclingKey = "disabled-restore"
            fresh.leftActionsWidth = 80f
            fresh.rightActionsWidth = 120f
            fresh.applyPendingConfiguration()
            repeat(3) { fresh.addView(FrameLayout(activity)) }
            root.addView(fresh, FrameLayout.LayoutParams(400, 64))
            fresh.layout(0, 0, 400, 64)
            settle()
            assertEquals(openX, content(fresh).translationX, .01f)
            assertEquals(side.value, SwipeableView.getOpenSideByKey("disabled-restore"))
            assertTrue(named("onSwipeStart").isEmpty())
            root.removeView(fresh)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun closeAllClosesUnmountedKeyedRowsAndStillClosesMountedRows() {
        val unmounted = row(key = "unmounted")
        unmounted.open(SwipeSide.LEFT)
        settle()
        root.removeView(unmounted)
        assertEquals("left", SwipeableView.getOpenSideByKey("unmounted"))
        val mounted = row(key = "mounted")
        mounted.open(SwipeSide.RIGHT)
        settle()
        events.clear()
        SwipeableView.closeAll()
        settle()
        assertNull(SwipeableView.getOpenSideByKey("unmounted"))
        assertEquals(0f, content(mounted).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("mounted"))
        assertEquals(listOf("closed:right"), ends())
        val remounted = row(key = "unmounted")
        settle()
        assertEquals(0f, content(remounted).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("unmounted"))
    }

    @Test fun keyedCloseClosesARowThatUnbindsBeforeTheQueuedClose() {
        for (unbind in listOf("rebind", "detach")) {
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            assertEquals("left", SwipeableView.getOpenSideByKey("late"))
            SwipeableView.closeByKey("late")
            if (unbind == "rebind") row.recyclingKey = "other" else root.removeView(row)
            settle()
            assertNull(unbind, SwipeableView.getOpenSideByKey("late"))
            root.removeView(row)
            val remounted = row(key = "late")
            settle()
            assertEquals(unbind, 0f, content(remounted).translationX, 0f)
            root.removeView(remounted)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun closeAllClosesRowsThatUnbindBeforeTheQueuedClose() {
        for (unbind in listOf("rebind", "detach")) {
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            assertEquals("left", SwipeableView.getOpenSideByKey("late"))
            SwipeableView.closeAll()
            if (unbind == "rebind") row.recyclingKey = "other" else root.removeView(row)
            settle()
            assertNull(unbind, SwipeableView.getOpenSideByKey("late"))
            root.removeView(row)
            val remounted = row(key = "late")
            settle()
            assertEquals(unbind, 0f, content(remounted).translationX, 0f)
            root.removeView(remounted)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun commandedCloseHoldsWhenTheKeyRebindsBeforeTheQueuedClose() {
        for (command in listOf("closeByKey", "closeAll")) {
            for (rebind in listOf("newView", "sameView", "reattach")) {
                val label = "$command $rebind"
                val row = row(key = "late")
                row.open(SwipeSide.LEFT)
                settle()
                assertEquals(label, "left", SwipeableView.getOpenSideByKey("late"))
                if (command == "closeByKey") SwipeableView.closeByKey("late") else SwipeableView.closeAll()
                // The key binds again before the main looper runs the queued close.
                val bound = when (rebind) {
                    "newView" -> {
                        row.recyclingKey = "other"
                        row(key = "late")
                    }
                    "sameView" -> {
                        row.recyclingKey = "other"
                        row.recyclingKey = "late"
                        row.applyPendingConfiguration()
                        row
                    }
                    else -> {
                        root.removeView(row)
                        root.addView(row, FrameLayout.LayoutParams(400, 64))
                        row.layout(0, 0, 400, 64)
                        row
                    }
                }
                settle()
                assertEquals(label, 0f, content(bound).translationX, 0f)
                assertNull(label, SwipeableView.getOpenSideByKey("late"))
                root.removeAllViews()
                SwipeableView.clearCache()
                events.clear()
            }
        }
    }

    @Test fun commandedCloseClearsBoundCachedIntentAtCommandTime() {
        for (command in listOf("closeByKey", "closeAll")) {
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            closeLate(command)
            assertNull(command, SwipeableView.getOpenSideByKey("late"))
            settle()
            assertEquals(command, 0f, content(row).translationX, 0f)
            assertNull(command, SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun commandedCloseHoldsInEveryBindingOrder() {
        for (command in listOf("closeByKey", "closeAll")) for (order in BINDING_ORDERS) {
            val label = "$command $order"
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            closeLate(command)
            val bound = rebindLate(row, order)
            settle()
            assertEquals(label, 0f, content(bound).translationX, 0f)
            assertNull(label, SwipeableView.getOpenSideByKey("late"))
            // A later binding, after every queued command ran, restores closed too.
            root.removeAllViews()
            val remounted = row(key = "late")
            settle()
            assertEquals(label, 0f, content(remounted).translationX, 0f)
            assertNull(label, SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun openAfterTheCloseCommandPersistsInEveryBindingOrder() {
        for (command in listOf("closeByKey", "closeAll")) for (order in BINDING_ORDERS) {
            val label = "$command $order"
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            closeLate(command)
            // A later intent on the main thread, before the queued close runs.
            row.open(SwipeSide.LEFT)
            val bound = rebindLate(row, order)
            settle()
            assertEquals(label, 160f, content(bound).translationX, .01f)
            assertEquals(label, "left", SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun keyedOpenIssuedBeforeTheCloseCannotOutliveItInAnyBindingOrder() {
        for (command in listOf("closeByKey", "closeAll")) for (order in BINDING_ORDERS) {
            val label = "$command $order"
            val row = row(key = "late")
            settle()
            SwipeableView.openByKeyOnSide("late", SwipeSide.LEFT)
            closeLate(command)
            // Only the earlier open runs before the key rebinds.
            shadowOf(Looper.getMainLooper()).runOneTask()
            assertTrue(label, named("onActionsNeeded").any { it["side"] == "left" })
            val bound = rebindLate(row, order)
            settle()
            assertEquals(label, 0f, content(bound).translationX, 0f)
            assertNull(label, SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun keyedOpenCannotLandOnABindingThatChangedBeforeItsPost() {
        for (change in listOf("roundTrip", "roundTripAfterUnrelatedClose", "reattach")) {
            val row = row(key = "late")
            settle()
            // The command thread read the target and intent, then the main thread rebinds.
            SwipeableView.afterOpenCapture = {
                SwipeableView.afterOpenCapture = null
                if (change == "roundTripAfterUnrelatedClose") SwipeableView.closeByKey("unrelated")
                rebindLate(row, if (change == "reattach") "reattach" else "roundTrip")
            }
            try {
                SwipeableView.openByKeyOnSide("late", SwipeSide.LEFT)
            } finally {
                SwipeableView.afterOpenCapture = null
            }
            settle()
            assertEquals(change, 0f, content(row).translationX, 0f)
            assertNull(change, SwipeableView.getOpenSideByKey("late"))
            assertTrue(change, named("onActionsNeeded").none { it["side"] == "left" })
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun openIssuedAfterTheCloseCommandWinsOverTheQueuedCloseWithoutARebind() {
        for (command in listOf("closeByKey", "closeAll")) for (opener in listOf("sameSide", "otherSide")) {
            val label = "$command $opener"
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            closeLate(command)
            // A later intent on the main thread, before the queued close runs.
            if (opener == "sameSide") row.open(SwipeSide.LEFT) else row.open(SwipeSide.RIGHT)
            settle()
            val (offset, side) = if (opener == "sameSide") 160f to "left" else -240f to "right"
            assertEquals(label, offset, content(row).translationX, .01f)
            assertEquals(label, side, SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun keyedCloseKeepsItsEpochAfterManyOtherClosesWithPerViewMemory() {
        val row = row(key = "late")
        row.open(SwipeSide.LEFT)
        settle()
        SwipeableView.closeByKey("late")
        val before = staticStateSizes()
        assertTrue(before.containsKey("openStateCache"))
        // More distinct closed keys than the cache holds, before the queued close runs.
        repeat(1100) { SwipeableView.closeByKey("gone-$it") }
        // Keyed closes keep no per-key state: memory stays per live view.
        staticStateSizes().forEach { (name, size) -> assertTrue(name, size <= before.getValue(name)) }
        // The earlier close still makes the pre-close open stale.
        row.recyclingKey = "other"
        val bound = row(key = "late")
        settle()
        assertEquals(0f, content(bound).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("late"))
    }

    @Test fun neverClosedOpenRowStaysOpenAfterMoreKeyedClosesThanTheCacheHolds() {
        for (order in BINDING_ORDERS) {
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            // Closes of other keys, more than the cache holds, never stale this open.
            repeat(1100) { SwipeableView.closeByKey("gone-$it") }
            val bound = rebindLate(row, order)
            settle()
            assertEquals(order, 160f, content(bound).translationX, .01f)
            assertEquals(order, "left", SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun commandedCloseStalesAPendingRestoreOnAViewThatLostTheRegistry() {
        for (command in listOf("closeByKey", "closeAll")) {
            val first = row(key = "late")
            first.open(SwipeSide.LEFT)
            settle()
            root.removeView(first)
            assertEquals(command, "left", SwipeableView.getOpenSideByKey("late"))
            // This binding reads the open side. Its restore waits for the next frame.
            val pending = row(key = "other")
            pending.recyclingKey = "late"
            // A newer binding takes the registry entry before the close.
            val replacement = row(key = "late")
            closeLate(command)
            replacement.recyclingKey = "elsewhere"
            settle()
            assertEquals(command, 0f, content(pending).translationX, 0f)
            assertNull(command, SwipeableView.getOpenSideByKey("late"))
            root.removeAllViews()
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun keyedCancelClearsAnUnmountedRowsCachedOpenBeforeRemount() {
        for (side in SwipeSide.values()) {
            val old = row(key = "cancelled")
            old.open(side)
            settle()
            root.removeView(old)
            assertEquals(side.value, SwipeableView.getOpenSideByKey("cancelled"))
            events.clear()
            SwipeableView.cancelByKey("cancelled")
            assertNull(side.value, SwipeableView.getOpenSideByKey("cancelled"))
            val remounted = row(key = "cancelled")
            settle()
            assertEquals(side.value, 0f, content(remounted).translationX, 0f)
            assertNull(side.value, SwipeableView.getOpenSideByKey("cancelled"))
            assertTrue(side.value, events.isEmpty())
            root.removeView(remounted)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun keyedCancelClosesARowThatUnbindsBeforeTheQueuedCancel() {
        for (unbind in listOf("rebind", "detach")) {
            val row = row(key = "late")
            row.open(SwipeSide.LEFT)
            settle()
            SwipeableView.cancelByKey("late")
            if (unbind == "rebind") row.recyclingKey = "other" else root.removeView(row)
            settle()
            assertNull(unbind, SwipeableView.getOpenSideByKey("late"))
            root.removeView(row)
            val remounted = row(key = "late")
            settle()
            assertEquals(unbind, 0f, content(remounted).translationX, 0f)
            root.removeView(remounted)
            SwipeableView.clearCache()
            events.clear()
        }
    }

    @Test fun keyedCancelOfABoundRowStillCancelsWithoutCompletion() {
        val row = row(key = "bound")
        row.open(SwipeSide.LEFT)
        settle()
        SwipeableView.cancelByKey("bound")
        assertNull(SwipeableView.getOpenSideByKey("bound"))
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        events.clear()
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        SwipeableView.cancelByKey("bound")
        settle()
        row.handleGestureEnd(120f, 0f)
        settle()
        assertEquals(0f, content(row).translationX, 0f)
        assertNull(SwipeableView.getOpenSideByKey("bound"))
        assertTrue(ends().isEmpty())
    }

    @Test fun openIssuedAfterAKeyedCancelWins() {
        val old = row(key = "later")
        old.open(SwipeSide.LEFT)
        settle()
        root.removeView(old)
        SwipeableView.cancelByKey("later")
        val remounted = row(key = "later")
        SwipeableView.openByKey("later")
        settle()
        assertEquals(-240f, content(remounted).translationX, .01f)
        assertEquals("right", SwipeableView.getOpenSideByKey("later"))
        root.removeView(remounted)
        settle()
        assertEquals("right", SwipeableView.getOpenSideByKey("later"))
        val restored = row(key = "later")
        settle()
        assertEquals(-240f, content(restored).translationX, .01f)
    }

    /** The size of every static collection the view class keeps. */
    private fun staticStateSizes(): Map<String, Int> = SwipeableView::class.java.declaredFields
        .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) }
        .mapNotNull { field ->
            field.isAccessible = true
            when (val value = field.get(null)) {
                is Map<*, *> -> field.name to value.size
                is Collection<*> -> field.name to value.size
                is androidx.collection.LruCache<*, *> -> field.name to value.size()
                else -> null
            }
        }.toMap()

    private val BINDING_ORDERS = listOf(
        "oldUnbindsFirst", "newBindsFirst", "newBindsFirstThenOldDetaches", "roundTrip", "reattach"
    )

    private fun closeLate(command: String) {
        if (command == "closeByKey") SwipeableView.closeByKey("late") else SwipeableView.closeAll()
    }

    /** Moves key "late" to a new binding before the main looper runs queued commands. */
    private fun rebindLate(row: SwipeableView, order: String): SwipeableView = when (order) {
        "oldUnbindsFirst" -> {
            row.recyclingKey = "other"
            row(key = "late")
        }
        "newBindsFirst" -> row(key = "late").also { row.recyclingKey = "other" }
        "newBindsFirstThenOldDetaches" -> row(key = "late").also { root.removeView(row) }
        "roundTrip" -> row.apply {
            recyclingKey = "other"
            recyclingKey = "late"
            applyPendingConfiguration()
        }
        else -> row.apply {
            root.removeView(this)
            root.addView(this, FrameLayout.LayoutParams(400, 64))
            layout(0, 0, 400, 64)
        }
    }

    private fun consumeCancellation(key: String, side: String) {
        assertEquals(listOf(mapOf("side" to side, "recyclingKey" to key)), named("onGestureCancelled"))
        // Keep the existing no-consumer-event assertions after asserting the internal signal.
        events.removeAll { it.first == "onGestureCancelled" }
    }

    private fun reactRow(): SwipeableView {
        val row = row(children = false)
        row.id = 100
        repeat(2) { index ->
            val rail = ReactViewGroup(activity).apply { id = 102 + index * 2 }
            rail.addView(View(activity).apply { id = 110 + index * 2 })
            row.addView(rail)
        }
        row.addView(FrameLayout(activity).apply { id = 120 })
        row.measure(View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(64, View.MeasureSpec.EXACTLY))
        row.layout(0, 0, 400, 64)
        // ReactViewGroup leaves descendant layout to Fabric/Yoga.
        (row.getChildAt(0) as ReactViewGroup).getChildAt(0).layout(0, 0, 160, 64)
        (row.getChildAt(1) as ReactViewGroup).getChildAt(0).layout(160, 0, 400, 64)
        return row
    }

    private fun tapReactTarget(row: SwipeableView, target: View, x: Float) {
        // Use the same transform-aware target lookup as React's JS touch dispatcher,
        // not only ViewGroup.dispatchTouchEvent (which already skips INVISIBLE views).
        assertEquals(target.id, TouchTargetHelper.findTargetTagForTouch(x, 32f, row))
        motion(MotionEvent.ACTION_DOWN, x, 32f).useEvent { assertTrue(row.dispatchTouchEvent(it)) }
        motion(MotionEvent.ACTION_UP, x, 32f).useEvent { assertTrue(row.dispatchTouchEvent(it)) }
        settle()
    }

    private fun row(bothSides: Boolean = true, key: String = "row", children: Boolean = true): SwipeableView {
        val row = SwipeableView(activity, mockk<AppContext>(relaxed = true))
        row.leftActionsWidth = if (bothSides) 80f else 0f
        row.rightActionsWidth = if (bothSides) 120f else 80f
        row.recyclingKey = key
        row.applyPendingConfiguration()
        if (children) repeat(3) { row.addView(FrameLayout(activity)) }
        root.addView(row, FrameLayout.LayoutParams(400, 64))
        row.layout(0, 0, 400, 64)
        return row
    }

    private fun content(row: SwipeableView): View = row.getChildAt(2)
    private fun settle() {
        // Paused vsync delivers on clock advancement; advance a frame at a time
        // so real SpringAnimation updates run between successive frames.
        repeat(200) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16)) }
    }
    private fun named(name: String) = events.filter { it.first == name }.map { it.second }
    private fun ends() = named("onSwipeEnd").map { "${it["state"]}:${it["side"]}" }
    private fun assertHidden(view: View) {
        assertEquals(View.INVISIBLE, view.visibility)
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS, view.importantForAccessibility)
    }
    private fun motion(action: Int, x: Float, y: Float) = MotionEvent.obtain(0, 20, action, x, y, 0)
    private fun MotionEvent.useEvent(block: (MotionEvent) -> Unit) { try { block(this) } finally { recycle() } }
}
