import XCTest
@testable import SwipeableActions

final class SwipeMainIntegrationTests: XCTestCase {
    private final class Child {}

    func testReleasedGestureOwnershipSurvivesSettleAndCancelsExactlyOnceOnWidthChange() {
        for side in SwipeSide.allCases {
            for opening in [true, false] {
                var completion = SwipeGestureCompletion()
                completion.begin()
                // finishGesture -> beginOpen/performClose invalidates animation work,
                // but transfers this ownership after touch activation has ended.
                XCTAssertFalse(completion.invalidate(preserving: true))
                XCTAssertTrue(completion.isPending)
                let result = SwipePhysics.reconcileTwoSidedState(
                    openSide: opening ? side : nil, autoCloseState: nil,
                    leftWidth: 95, rightWidth: 140,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: false
                )
                XCTAssertTrue(completion.invalidate(preserving: result.autoClose != nil))
                XCTAssertFalse(completion.isPending)
                XCTAssertFalse(completion.invalidate(), "Repeated reconciliation must not cancel twice")
                completion.begin()
                XCTAssertTrue(completion.isPending, "A fresh gesture owns a fresh completion")
                completion.complete()
                XCTAssertFalse(completion.invalidate(), "A completed gesture must not be cancelled")
            }
        }
    }

    func testProgrammaticAnimationNeverOwnsGestureCancellation() {
        var completion = SwipeGestureCompletion()
        XCTAssertFalse(completion.invalidate())
        XCTAssertFalse(completion.invalidate(preserving: true))
        completion.complete()
        XCTAssertFalse(completion.invalidate())
    }

    func testAutoCloseRetainsOwnershipAcrossWidthChangesButNotRemovedSide() {
        for side in SwipeSide.allCases {
            for pending in [SwipeAutoCloseState.waiting(side: side, deadline: 10), .closing(side: side)] {
                var completion = SwipeGestureCompletion()
                completion.begin()
                let openSide: SwipeSide? = pending == .closing(side: side) ? nil : side
                let retained = SwipePhysics.reconcileTwoSidedState(
                    openSide: openSide, autoCloseState: pending,
                    leftWidth: 95, rightWidth: 140,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: true
                )
                XCTAssertFalse(completion.invalidate(preserving: retained.autoClose != nil))
                XCTAssertTrue(completion.isPending)
                let removed = SwipePhysics.reconcileTwoSidedState(
                    openSide: openSide, autoCloseState: pending,
                    leftWidth: side == .left ? 0 : 95, rightWidth: side == .right ? 0 : 140,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: true
                )
                XCTAssertTrue(completion.invalidate(preserving: removed.autoClose != nil))
                XCTAssertFalse(completion.isPending)
            }
        }
    }

    func testCommandAndRebindDropOwnershipWithoutSyntheticCompletion() {
        var completion = SwipeGestureCompletion()
        completion.begin()
        completion.invalidate(preserving: true)
        XCTAssertTrue(completion.invalidate())
        XCTAssertFalse(completion.isPending)
        XCTAssertFalse(completion.invalidate())
    }

    func testDisabledImperativeOpenSurvivesPositiveWidthUpdatesOnEitherSide() {
        for side in SwipeSide.allCases {
            for width: CGFloat in [95, 140] {
                let result = SwipePhysics.reconcileTwoSidedState(
                    openSide: side, autoCloseState: nil, leftWidth: width, rightWidth: width,
                    wasGestureEnabled: false, gestureEnabled: false, autoClose: false
                )
                XCTAssertEqual(result.openSide, side)
                XCTAssertEqual(result.openSide.map { $0.sign * width }, side.sign * width)
                XCTAssertNil(result.autoClose)
            }
        }
    }

    func testActualGestureDisableStillClosesAndDropsPendingCompletion() {
        let result = SwipePhysics.reconcileTwoSidedState(
            openSide: .left, autoCloseState: .waiting(side: .left, deadline: 10),
            leftWidth: 80, rightWidth: 120,
            wasGestureEnabled: true, gestureEnabled: false, autoClose: true
        )
        XCTAssertNil(result.openSide)
        XCTAssertNil(result.autoClose)
    }

    func testWidthChangesPreserveOriginalAutoCloseDeadlineWithoutPostponingCompletion() {
        for side in SwipeSide.allCases {
            var pending: SwipeAutoCloseState? = .waiting(side: side, deadline: 10)
            for now: TimeInterval in [0, 3, 6, 10, 12] {
                let result = SwipePhysics.reconcileTwoSidedState(
                    openSide: side, autoCloseState: pending,
                    leftWidth: 80 + now, rightWidth: 120 + now,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: true
                )
                XCTAssertEqual(result.openSide, side)
                XCTAssertEqual(result.autoClose, .waiting(side: side, deadline: 10))
                XCTAssertEqual(result.autoClose?.remainingDelay(at: now), max(0, 10 - now))
                pending = result.autoClose
            }
        }
    }

    func testWidthChangeDuringAutoCloseKeepsClosingIntentWithoutReopening() {
        for side in SwipeSide.allCases {
            let result = SwipePhysics.reconcileTwoSidedState(
                openSide: nil, autoCloseState: .closing(side: side),
                leftWidth: 95, rightWidth: 150,
                wasGestureEnabled: true, gestureEnabled: true, autoClose: true
            )
            XCTAssertNil(result.openSide)
            XCTAssertEqual(result.autoClose, .closing(side: side))
        }
    }

    func testRemovedEdgeAndCancelledAutoCloseNeverResumeCompletion() {
        for side in SwipeSide.allCases {
            for pending in [SwipeAutoCloseState.waiting(side: side, deadline: 10), .closing(side: side)] {
                let result = SwipePhysics.reconcileTwoSidedState(
                    openSide: side, autoCloseState: pending,
                    leftWidth: side == .left ? 0 : 80, rightWidth: side == .right ? 0 : 120,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: true
                )
                XCTAssertNil(result.openSide)
                XCTAssertNil(result.autoClose)
            }
            let cancelled = SwipePhysics.reconcileTwoSidedState(
                openSide: side, autoCloseState: nil, leftWidth: 95, rightWidth: 150,
                wasGestureEnabled: true, gestureEnabled: true, autoClose: true
            )
            XCTAssertEqual(cancelled.openSide, side)
            XCTAssertNil(cancelled.autoClose, "Width updates cannot invent a completion for an imperative open")
        }
    }

    func testRoleAssignmentUsesFabricMountOrderNotHelperSubviews() {
        let helper = Child()
        let left = Child()
        let right = Child()
        let content = Child()
        var children = SwipeReactChildren<Child>()
        children.mount(left, at: 0)
        children.mount(content, at: 1)
        XCTAssertNil(SwipePhysics.childRoles(count: children.views.count, twoSided: true))
        children.mount(right, at: 1)

        let roles = SwipePhysics.childRoles(count: children.views.count, twoSided: true)!
        XCTAssertTrue(children.views[roles.left!] === left)
        XCTAssertTrue(children.views[roles.right!] === right)
        XCTAssertTrue(children.views[roles.content] === content)
        XCTAssertFalse(children.views.contains { $0 === helper })
    }

    func testUnmountFallsBackToIdentityInsteadOfRemovingNeighbor() {
        let left = Child()
        let right = Child()
        let content = Child()
        var children = SwipeReactChildren<Child>()
        children.mount(left, at: 0)
        children.mount(right, at: 1)
        children.mount(content, at: 2)
        children.unmount(content, at: 0)
        XCTAssertEqual(children.views.count, 2)
        XCTAssertTrue(children.views[0] === left)
        XCTAssertTrue(children.views[1] === right)
        XCTAssertNil(SwipePhysics.childRoles(count: children.views.count, twoSided: true))
        children.unmount(Child(), at: 0)
        XCTAssertEqual(children.views.count, 2)
    }

    func testRemountDoesNotDuplicateChildAndClampsFabricIndex() {
        let actions = Child()
        let content = Child()
        var children = SwipeReactChildren<Child>()
        children.mount(content, at: 99)
        children.mount(actions, at: -1)
        children.mount(content, at: 99)
        XCTAssertEqual(children.views.count, 2)
        let roles = SwipePhysics.childRoles(count: children.views.count, twoSided: false)!
        XCTAssertTrue(children.views[roles.actions!] === actions)
        XCTAssertTrue(children.views[roles.content] === content)
        children.unmount(actions, at: 0)
        XCTAssertTrue(children.views[0] === content)
    }

    func testOpenWidthResyncRequiresActualPositiveChangeAndIdleOpenRow() {
        for widths: (CGFloat, CGFloat) in [(80, 120), (120, 80)] {
            XCTAssertTrue(SwipePhysics.shouldSyncOpenWidth(
                oldWidth: widths.0, newWidth: widths.1, isOpen: true, isInteracting: false
            ))
            XCTAssertFalse(SwipePhysics.shouldSyncOpenWidth(
                oldWidth: widths.0, newWidth: widths.1, isOpen: true, isInteracting: true
            ))
            XCTAssertFalse(SwipePhysics.shouldSyncOpenWidth(
                oldWidth: widths.0, newWidth: widths.1, isOpen: false, isInteracting: false
            ))
        }
        for width: CGFloat in [80, 0, -1] {
            XCTAssertFalse(SwipePhysics.shouldSyncOpenWidth(
                oldWidth: 80, newWidth: width, isOpen: true, isInteracting: false
            ))
        }
    }

    func testDetachRestoresOnlySettledTwoSidedIntent() {
        XCTAssertTrue(SwipePhysics.shouldRestoreAfterDetach(twoSided: true, hasPendingInteraction: false))
        XCTAssertFalse(SwipePhysics.shouldRestoreAfterDetach(twoSided: true, hasPendingInteraction: true))
        XCTAssertFalse(SwipePhysics.shouldRestoreAfterDetach(twoSided: false, hasPendingInteraction: false))
        XCTAssertFalse(SwipePhysics.shouldRestoreAfterDetach(twoSided: false, hasPendingInteraction: true))
    }

    func testCloseForUnboundRowClearsCachedSideBeforeFutureRestore() {
        var cache = SwipeOpenStateCache(capacity: 2)
        for side in SwipeSide.allCases {
            cache.set(side, for: "a")
            cache.clearIfUnbound(for: "a", hasCurrentBinding: false)
            XCTAssertNil(cache.side(for: "a"))
        }
    }

    func testUnboundCloseClearsIntentBeforeRemountWithoutDelayedWork() {
        var cache = SwipeOpenStateCache(capacity: 2)
        cache.set(.left, for: "a")
        var current: SwipeCommandTarget<Child>?
        let captured = cache.captureCloseTarget(for: "a", current: current)
        XCTAssertNil(captured)
        // The row remounts before any main-queue command can execute.
        let remounted = Child()
        current = SwipeCommandTarget(remounted)
        XCTAssertNil(cache.side(for: "a"), "Remount must not restore the pre-close open side")

        // Later explicit intent belongs to the new binding, not this unbound close.
        cache.set(.right, for: "a")
        var queued: [() -> Void] = []
        if let captured = captured {
            queued.append {
                captured.perform(ifCurrent: current) { _ in XCTFail("Unbound close reached remount") }
                cache.clearIfUnbound(for: "a", hasCurrentBinding: current?.value != nil)
            }
        }
        current = nil
        queued.forEach { $0() }
        XCTAssertTrue(queued.isEmpty)
        XCTAssertEqual(cache.side(for: "a"), .right)
    }

    func testCloseCaptureTreatsDeadWeakTargetAsUnbound() {
        var cache = SwipeOpenStateCache(capacity: 2)
        var view: Child? = Child()
        let expiredBinding = SwipeCommandTarget(view!)
        view = nil
        XCTAssertNil(expiredBinding.value)
        cache.set(.right, for: "a")
        XCTAssertNil(cache.captureCloseTarget(for: "a", current: expiredBinding))
        XCTAssertNil(cache.side(for: "a"))
    }

    func testRejectedOldCloseCannotClearReplacementBindingCache() {
        let view = Child()
        let oldBinding = SwipeCommandTarget(view)
        let replacementBinding = SwipeCommandTarget(view)
        var cache = SwipeOpenStateCache(capacity: 2)
        cache.set(.left, for: "a")
        let captured = cache.captureCloseTarget(for: "a", current: oldBinding)
        XCTAssertTrue(captured === oldBinding)
        XCTAssertEqual(cache.side(for: "a"), .left, "Bound capture must not change cached intent")
        cache.set(.right, for: "a")
        captured?.perform(ifCurrent: replacementBinding) { _ in
            XCTFail("A queued close must not operate on an A -> B -> A binding")
        }
        cache.clearIfUnbound(for: "a", hasCurrentBinding: replacementBinding.value != nil)
        XCTAssertEqual(cache.side(for: "a"), .right)
    }

    func testCancelDoesNotInvalidateLaterCommandsForSameBinding() {
        let view = Child()
        let binding = SwipeCommandTarget(view)
        var received: [String] = []
        for command in ["open(left)", "cancel", "open(right)", "close(false)"] {
            binding.perform(ifCurrent: binding) { _ in received.append(command) }
        }
        XCTAssertEqual(received, ["open(left)", "cancel", "open(right)", "close(false)"])
        let rebound = SwipeCommandTarget(view)
        binding.perform(ifCurrent: rebound) { _ in XCTFail("Stale cancel was delivered") }
    }
}
