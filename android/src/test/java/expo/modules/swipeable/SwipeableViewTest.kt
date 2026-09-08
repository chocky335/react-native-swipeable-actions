package expo.modules.swipeable

import android.app.Activity
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.uimanager.PointerEvents
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
        root = FrameLayout(activity)
        activity.setContentView(root)
        controller.visible()
    }

    @After fun tearDown() {
        root.removeAllViews()
        controller.pause().stop().destroy()
        SwipeableView.clearCache()
        unmockkAll()
    }

    @Test fun defaultModeKeepsLegacyHierarchyAndRightOpen() {
        val row = row(twoSided = false)
        assertFalse(row.twoSided)
        assertEquals(2, row.childCount)
        row.open()
        settle()
        assertEquals(-160f, row.getChildAt(1).translationX, .01f)
        assertEquals(listOf("open:null"), ends())
        assertEquals(0, named("onSwipeStart").size)
    }

    @Test fun directLegacyGestureKeepsRubberBandAndCallbackCadence() {
        val row = row(twoSided = false)
        row.handleGestureStart()
        row.handleGestureUpdate(60f, 0f)
        assertEquals(20f, row.getChildAt(1).translationX, .01f)
        assertEquals(1, named("onSwipeStart").size)
        assertTrue(named("onSwipeStateChange").isEmpty())
        row.handleGestureEnd(-100f, 0f)
        settle()
        assertEquals(listOf("open:null"), ends())
        assertTrue(named("onSwipeStateChange").isEmpty())
    }

    @Test fun legacyProgrammaticAndDirectAutoClosePolicyIsUnchanged() {
        val row = row(twoSided = false)
        row.autoClose = true
        row.open()
        settle()
        assertTrue(SwipeableView.isOpenByKey("row"))
        assertTrue(ends().isEmpty())
        row.close(false)
        row.handleGestureStart()
        row.handleGestureEnd(-100f, 0f)
        settle()
        assertEquals(-160f, row.getChildAt(1).translationX, .01f)
        assertTrue(ends().isEmpty())
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

    @Test fun restoreUsesCachedEdgeAfterKeyBeforeWidthsAndModeProps() {
        val first = row(key = "cached")
        first.open(SwipeSide.LEFT)
        settle()
        root.removeView(first)
        events.clear()
        val restored = SwipeableView(activity, mockk<AppContext>(relaxed = true))
        restored.recyclingKey = "cached"
        restored.twoSided = true
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
        assertEquals("left", SwipeableView.getOpenSideByKey("a"))
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

    @Test fun legacyInstantClosePreservesCacheAndRestoreStartBehavior() {
        val row = row(twoSided = false)
        row.open()
        settle()
        row.close(false)
        assertTrue(SwipeableView.isOpenByKey("row"))
        root.removeView(row)
        events.clear()
        val restored = row(twoSided = false, children = false)
        settle()
        assertEquals(1, named("onSwipeStart").size)
        restored.addView(FrameLayout(activity))
        assertEquals(-160f, restored.getChildAt(0).translationX, .01f)
    }

    @Test fun nestedGestureClaimAndVerticalMovementAreNotIntercepted() {
        val row = row()
        motion(MotionEvent.ACTION_DOWN, 10f, 10f).useEvent { row.onInterceptTouchEvent(it) }
        row.requestDisallowInterceptTouchEvent(true)
        motion(MotionEvent.ACTION_MOVE, 110f, 12f).useEvent { assertFalse(row.onInterceptTouchEvent(it)) }
        row.requestDisallowInterceptTouchEvent(false)
        motion(MotionEvent.ACTION_MOVE, 12f, 110f).useEvent { assertFalse(row.onInterceptTouchEvent(it)) }
    }

    @Test fun keyedTwoSidedPayloadsCarryIdentityAndLegacyPayloadsDoNot() {
        val row = row(key = "identity")
        row.handleGestureStart()
        row.handleGestureUpdate(120f, 0f)
        row.handleGestureEnd(120f, 0f)
        settle()
        for (name in listOf("onActionsNeeded", "onSwipeProgress", "onSwipeStateChange", "onSwipeEnd")) {
            assertTrue("Missing $name", named(name).isNotEmpty())
            assertTrue(named(name).all { it["recyclingKey"] == "identity" && it["side"] == "left" })
        }
        assertTrue(named("onSwipeStart").all { it.isEmpty() })
        events.clear()
        val legacy = row(twoSided = false, key = "legacy")
        legacy.handleGestureStart()
        legacy.handleGestureEnd(-120f, 0f)
        settle()
        assertTrue(events.all { "recyclingKey" !in it.second })
        assertEquals(setOf("state"), named("onSwipeEnd").last().keys)
        assertEquals(setOf("progress", "translationX"), named("onSwipeProgress").last().keys)
    }

    @Test fun unchangedNewPropsDoNotInterruptLegacyGesture() {
        val row = row(twoSided = false)
        row.handleGestureStart()
        row.handleGestureUpdate(-60f, 0f)
        row.twoSided = false
        row.leftActionsWidth = 0f
        row.rightActionsWidth = 0f
        row.applyPendingConfiguration()
        row.handleGestureUpdate(-100f, 0f)
        assertEquals(-100f, row.getChildAt(1).translationX, .01f)
        row.handleGestureEnd(-100f, 0f)
        settle()
        assertEquals(listOf("open:null"), ends())
        assertEquals(1, named("onSwipeStart").size)
    }

    @Test fun switchingBackToLegacyWaitsForItsChildTransaction() {
        val row = row()
        row.open(SwipeSide.RIGHT)
        settle()
        val content = content(row)
        row.twoSided = false
        row.applyPendingConfiguration()
        row.removeViewAt(0)
        row.removeViewAt(0)
        row.addView(FrameLayout(activity), 0)
        settle()
        assertSame(content, row.getChildAt(1))
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
        for (twoSided in listOf(false, true)) {
            val row = row(twoSided = twoSided, key = "disabled-$twoSided")
            row.gestureEnabled = false
            row.applyPendingConfiguration()
            row.open()
            settle()
            val content = row.getChildAt(row.childCount - 1)
            assertEquals(if (twoSided) -240f else -160f, content.translationX, .01f)
            if (twoSided) {
                row.rightActionsWidth = 150f
                row.applyPendingConfiguration()
                assertEquals(-300f, content.translationX, .01f)
            }
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
        for (twoSided in listOf(false, true)) {
            val key = "ordered-$twoSided"
            val row = row(twoSided = twoSided, key = key)
            events.clear()
            SwipeableView.openByKey(key)
            SwipeableView.closeByKey(key, false)
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            // The legacy instant-close cache policy is intentionally unchanged.
            assertEquals(!twoSided, SwipeableView.isOpenByKey(key))
            assertTrue(ends().isEmpty())
        }
    }

    @Test fun queuedStaticCloseThenOpenCancelsTheClosingAnimation() {
        for (twoSided in listOf(false, true)) {
            val key = "ordered-$twoSided"
            val row = row(twoSided = twoSided, key = key)
            row.open()
            settle()
            events.clear()
            SwipeableView.closeByKey(key)
            SwipeableView.openByKey(key)
            settle()
            assertEquals(if (twoSided) -240f else -160f, row.getChildAt(row.childCount - 1).translationX, .01f)
            assertTrue(SwipeableView.isOpenByKey(key))
            assertEquals(listOf(if (twoSided) "open:right" else "open:null"), ends())
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
        for (twoSided in listOf(false, true)) {
            val key = "raw-$twoSided"
            val row = row(twoSided = twoSided, key = key)
            events.clear()
            row.postCommand { row.open() }
            row.postCommand { row.close(false) }
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertEquals(!twoSided, SwipeableView.isOpenByKey(key))
            assertTrue(ends().isEmpty())
        }
    }

    @Test fun queuedRawCloseThenOpenCancelsTheClosingAnimation() {
        for (twoSided in listOf(false, true)) {
            val key = "raw-$twoSided"
            val row = row(twoSided = twoSided, key = key)
            row.open()
            settle()
            events.clear()
            row.postCommand { row.close() }
            row.postCommand { row.open() }
            settle()
            assertEquals(if (twoSided) -240f else -160f, row.getChildAt(row.childCount - 1).translationX, .01f)
            assertTrue(SwipeableView.isOpenByKey(key))
            assertEquals(listOf(if (twoSided) "open:right" else "open:null"), ends())
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

    @Test fun twoSidedPointerGateDoesNotLeakIntoLegacyHierarchy() {
        val row = reactRow()
        val left = row.getChildAt(0) as ReactViewGroup
        val right = row.getChildAt(1) as ReactViewGroup
        row.twoSided = false
        row.applyPendingConfiguration()
        assertEquals(PointerEvents.AUTO, left.pointerEvents)
        assertEquals(PointerEvents.AUTO, right.pointerEvents)
        row.removeView(right)
        row.actionsPosition = "left"
        row.open()
        settle()
        assertEquals(2, row.childCount)
        assertEquals(160f, row.getChildAt(1).translationX, .01f)
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

    @Test fun cancelActiveDirectGestureSuppressesUpdatesAndCompletionInBothModes() {
        for (twoSided in listOf(false, true)) {
            val row = row(twoSided = twoSided, key = "cancel-$twoSided")
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
            assertFalse(SwipeableView.isOpenByKey("cancel-$twoSided"))
            assertTrue(events.isEmpty())
        }
    }

    @Test fun cancelBeforeActivationSuppressesAllTouchEntryPointsUntilFreshDown() {
        for (twoSided in listOf(false, true)) {
            val row = row(twoSided = twoSided, key = "touch-$twoSided")
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
        assertTrue(events.isEmpty())
    }

    @Test fun cancelFromSwipeStartDoesNotScheduleMoreGestureWork() {
        for (twoSided in listOf(false, true)) {
            val row = row(twoSided = twoSided, key = "start-$twoSided")
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
        assertEquals(listOf("onSwipeStateChange"), events.map { it.first })
    }

    @Test fun cancelAtZeroTranslationStopsOpeningSpringInBothModes() {
        for (twoSided in listOf(false, true)) {
            val key = "spring-$twoSided"
            val row = row(twoSided = twoSided, key = key)
            row.open()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            events.clear()
            row.cancelGesture()
            settle()
            assertEquals(0f, row.getChildAt(row.childCount - 1).translationX, 0f)
            assertEquals(!twoSided, SwipeableView.isOpenByKey(key))
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
        restored.twoSided = true
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

    @Test fun staticAndRawCancelExecuteAfterQueuedOpenInBothModes() {
        for (twoSided in listOf(false, true)) {
            for (raw in listOf(false, true)) {
                val key = "fifo-$twoSided-$raw"
                val row = row(twoSided = twoSided, key = key)
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
                assertEquals(!twoSided, SwipeableView.isOpenByKey(key))
                assertTrue(ends().isEmpty())
            }
        }
    }

    @Test fun staticAndRawCancelDoNotInvalidateFollowingOpenInBothModes() {
        for (twoSided in listOf(false, true)) {
            for (raw in listOf(false, true)) {
                val key = "fifo-$twoSided-$raw"
                val row = row(twoSided = twoSided, key = key)
                events.clear()
                if (raw) {
                    row.postCommand { row.cancelGesture() }
                    row.postCommand { row.open() }
                } else {
                    SwipeableView.cancelByKey(key)
                    SwipeableView.openByKey(key)
                }
                settle()
                assertEquals(if (twoSided) -240f else -160f, row.getChildAt(row.childCount - 1).translationX, .01f)
                assertTrue(SwipeableView.isOpenByKey(key))
                assertEquals(listOf(if (twoSided) "open:right" else "open:null"), ends())
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
        val row = row()
        row.open(SwipeSide.LEFT)
        settle()
        events.clear()
        SwipeableView.cancelByKey("row")
        row.postCommand { row.cancelGesture() }
        root.removeView(row)
        root.addView(row)
        settle()
        assertEquals(160f, content(row).translationX, .01f)
        assertEquals("left", SwipeableView.getOpenSideByKey("row"))
        assertTrue(ends().isEmpty())
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

    @Test fun legacySettledWidthChangeKeepsOpenSideAndCallbackContract() {
        for (position in listOf("left", "right")) {
            val row = row(twoSided = false, key = "width-$position")
            row.actionsPosition = position
            row.open()
            settle()
            events.clear()
            row.actionsWidth = 95f
            val target = if (position == "left") 190f else -190f
            assertEquals(target, row.getChildAt(1).translationX, .01f)
            assertEquals(0f, row.getChildAt(0).translationX, 0f)
            assertEquals(listOf(mapOf("progress" to 1.0, "translationX" to target.toDouble())), named("onSwipeProgress"))
            assertTrue(named("onSwipeStart").isEmpty())
            assertTrue(ends().isEmpty())
            assertTrue(SwipeableView.isOpenByKey("width-$position"))
        }
    }

    @Test fun legacySettledWidthChangeRequestsMissingActionsWithLegacyPayload() {
        val row = row(twoSided = false, children = false)
        row.open()
        settle()
        events.clear()
        row.actionsWidth = 95f
        assertEquals(listOf(emptyMap<String, Any>()), named("onSwipeStart"))
        assertEquals(listOf(mapOf("progress" to 1.0, "translationX" to -190.0)), named("onSwipeProgress"))
        assertTrue(ends().isEmpty())
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

    private fun row(twoSided: Boolean = true, key: String = "row", children: Boolean = true): SwipeableView {
        val row = SwipeableView(activity, mockk<AppContext>(relaxed = true))
        row.actionsWidth = 80f
        row.twoSided = twoSided
        if (twoSided) {
            row.leftActionsWidth = 80f
            row.rightActionsWidth = 120f
        }
        row.recyclingKey = key
        row.applyPendingConfiguration()
        if (children) repeat(if (twoSided) 3 else 2) { row.addView(FrameLayout(activity)) }
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
