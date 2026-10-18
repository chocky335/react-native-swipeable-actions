import XCTest
@testable import SwipeableActions

final class SwipeMainIntegrationTests: XCTestCase {
    private final class Child {}

    func testNativeFollowupTransferredOpenCancelsCapturedOwnerAfterRebind() {
        for side in SwipeSide.allCases {
            for key: String? in [nil, "old"] {
                var completion = SwipeGestureCompletion()
                completion.begin(recyclingKey: key, side: side)
                // Release, same-side imperative open, then animated close each
                // transfer the original owner without replacing its identity.
                for _ in 0..<3 {
                    XCTAssertFalse(completion.invalidate(preserving: true))
                    XCTAssertTrue(completion.isPending)
                }
                var expected = ["side": side.rawValue]
                if let key = key { expected["recyclingKey"] = key }
                XCTAssertEqual(completion.cancel(recyclingKey: "replacement", side: nil), expected)
                XCTAssertNil(completion.cancel(recyclingKey: "replacement", side: .right))
                completion.begin(recyclingKey: "replacement", side: .right)
                completion.complete()
                XCTAssertNil(completion.cancel(recyclingKey: "replacement", side: .right))
            }
        }
    }

    func testNativeFollowupAbandonmentIsQueuedBeforeFreshStartAndSurvivesAsyncDelivery() {
        for reason in ["fresh gesture", "detach", "rebind", "child removal", "auto-close imperative open"] {
            var completion = SwipeGestureCompletion()
            var queued: [(String, [String: String])] = []
            completion.begin(recyclingKey: "old", side: .left)
            queued.append(("start", ["recyclingKey": "old", "side": "left"]))
            let cancelled = completion.cancel(recyclingKey: "new", side: .right)
            XCTAssertEqual(cancelled, ["recyclingKey": "old", "side": "left"], reason)
            if let cancelled = cancelled { queued.append(("cancel", cancelled)) }
            // Reentry/new ownership is allowed only after the old owner is cleared.
            completion.begin(recyclingKey: "new", side: .right)
            queued.append(("start", ["recyclingKey": "new", "side": "right"]))
            XCTAssertEqual(queued.map { $0.0 }, ["start", "cancel", "start"], reason)
            XCTAssertEqual(queued[1].1, ["recyclingKey": "old", "side": "left"], reason)
            XCTAssertEqual(completion.cancel(recyclingKey: nil, side: nil),
                           ["recyclingKey": "new", "side": "right"], reason)
            XCTAssertNil(completion.cancel(recyclingKey: nil, side: nil), reason)
        }
    }

    func testNativeFollowupSameInstanceDetachAndReattachDoNotTransferOldTouchesOrCompletion() {
        let owner = Child()
        let original = SwipeCommandTarget(owner)
        let reattached = SwipeCommandTarget(owner)
        let held = Child()
        let fresh = Child()
        var touches = SwipeTouchBinding<Child>()
        var completion = SwipeGestureCompletion()
        touches.begin([held], target: original)
        completion.begin(recyclingKey: "same-row", side: .left)
        XCTAssertFalse(completion.invalidate(preserving: true))
        XCTAssertEqual(completion.cancel(recyclingKey: "same-row", side: .left),
                       ["recyclingKey": "same-row", "side": "left"])
        XCTAssertFalse(touches.isCurrent(reattached))
        XCTAssertNil(completion.cancel(recyclingKey: "same-row", side: .left))
        touches.end([held])
        touches.begin([fresh], target: reattached)
        XCTAssertTrue(touches.isCurrent(reattached))
        completion.begin(recyclingKey: "same-row", side: .right)
        completion.complete()
        XCTAssertNil(completion.cancel(recyclingKey: "same-row", side: .right))
    }

    func testNativeFollowupPureProgrammaticTakeoversNeverInventCancellation() {
        var completion = SwipeGestureCompletion()
        for _ in 0..<3 {
            XCTAssertFalse(completion.invalidate(preserving: true))
            XCTAssertNil(completion.cancel(recyclingKey: "row", side: .left))
        }
        completion.begin(recyclingKey: "row", side: .left)
        completion.complete()
        XCTAssertNil(completion.cancel(recyclingKey: "row", side: .left))
        completion.begin(recyclingKey: nil, side: .right)
        XCTAssertEqual(completion.cancel(recyclingKey: "later-key", side: .left), ["side": "right"])
    }

    func testAnimatedCloseOwnershipSurvivesUntilSilentInterruptionOrRealCompletion() {
        for side in SwipeSide.allCases {
            for released in [false, true] {
                var completion = SwipeGestureCompletion()
                completion.begin()
                if released { XCTAssertFalse(completion.invalidate(preserving: true)) }
                // performClose(animated: true) transfers ownership to its animator.
                XCTAssertFalse(completion.invalidate(preserving: true))
                XCTAssertEqual(completion.cancel(recyclingKey: "row", side: side),
                               ["recyclingKey": "row", "side": side.rawValue])
                XCTAssertNil(completion.cancel(recyclingKey: "row", side: side))
                completion.begin()
                XCTAssertFalse(completion.invalidate(preserving: true))
                completion.complete()
                XCTAssertNil(completion.cancel(recyclingKey: "row", side: side))
            }
        }
        var programmatic = SwipeGestureCompletion()
        XCTAssertFalse(programmatic.invalidate(preserving: true))
        XCTAssertFalse(programmatic.isPending)
        XCTAssertNil(programmatic.cancel(recyclingKey: "row", side: .right))
    }

    func testTouchBindingRejectsPossiblePanAfterRebindAndAcceptsFreshTouch() {
        let owner = Child()
        let oldBinding = SwipeCommandTarget(owner)
        let replacement = SwipeCommandTarget(owner)
        let oldFinger = Child()
        let addedFinger = Child()
        let freshFinger = Child()
        var touch = SwipeTouchBinding<Child>()
        touch.begin([oldFinger], target: oldBinding)
        XCTAssertTrue(touch.isCurrent(oldBinding))
        // No activation happened before this binding change: the pan is .possible.
        XCTAssertFalse(touch.isCurrent(replacement))
        touch.begin([addedFinger], target: replacement)
        XCTAssertFalse(touch.isCurrent(replacement), "A second finger cannot transfer the old sequence")
        touch.end([oldFinger])
        XCTAssertFalse(touch.isCurrent(replacement))
        touch.end([addedFinger])
        touch.begin([freshFinger], target: replacement)
        XCTAssertTrue(touch.isCurrent(replacement), "A fresh gesture must not remain suppressed")
        touch.end([freshFinger])
        XCTAssertTrue(touch.isCurrent(replacement), "Queued end actions retain the original identity")
    }

    func testTouchBindingRejectsRoundTripRebindAndRecoversAfterFinishedTouchPruning() {
        let owner = Child()
        let firstBinding = SwipeCommandTarget(owner)
        let reboundSameOwner = SwipeCommandTarget(owner)
        let oldFinger = Child()
        let newFinger = Child()
        var touch = SwipeTouchBinding<Child>()
        touch.begin([oldFinger], target: firstBinding)
        XCTAssertFalse(touch.isCurrent(reboundSameOwner))
        // UIKit may omit the ended callback after recognition failed. The next
        // touchesBegan prunes physically ended contacts before capturing ownership.
        touch.prune(keeping: [Child]())
        touch.begin([newFinger], target: reboundSameOwner)
        XCTAssertTrue(touch.isCurrent(reboundSameOwner))
        touch.end([newFinger])
        touch.begin([oldFinger], target: reboundSameOwner)
        XCTAssertTrue(touch.isCurrent(reboundSameOwner))
    }

    func testSilentCancelCapturesKeyAndSideForActiveAndReleasedOwnershipExactlyOnce() {
        for side in SwipeSide.allCases {
            for released in [false, true] {
                for key: String? in [nil, "row-a"] {
                    var completion = SwipeGestureCompletion()
                    completion.begin()
                    if released { XCTAssertFalse(completion.invalidate(preserving: true)) }
                    var expected = ["side": side.rawValue]
                    if let key = key { expected["recyclingKey"] = key }
                    XCTAssertEqual(completion.cancel(recyclingKey: key, side: side), expected)
                    XCTAssertFalse(completion.isPending)
                    XCTAssertNil(completion.cancel(recyclingKey: key, side: side))
                    completion.begin()
                    XCTAssertTrue(completion.isPending)
                    completion.complete()
                    XCTAssertNil(completion.cancel(recyclingKey: key, side: side))
                }
            }
        }
    }

    func testSilentCloseDoesNotInventCancellationForProgrammaticWork() {
        var completion = SwipeGestureCompletion()
        XCTAssertNil(completion.cancel(recyclingKey: "row-a", side: .left))
        completion.begin()
        XCTAssertEqual(completion.cancel(recyclingKey: nil, side: nil), [:])
        XCTAssertNil(completion.cancel(recyclingKey: "replacement", side: .right))
    }

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
        XCTAssertNil(SwipePhysics.childRoles(count: children.views.count))
        children.mount(right, at: 1)

        let roles = SwipePhysics.childRoles(count: children.views.count)!
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
        XCTAssertNil(SwipePhysics.childRoles(count: children.views.count))
        children.unmount(Child(), at: 0)
        XCTAssertEqual(children.views.count, 2)
    }

    func testRemountDoesNotDuplicateChildAndClampsFabricIndex() {
        let left = Child()
        let right = Child()
        let content = Child()
        var children = SwipeReactChildren<Child>()
        children.mount(content, at: 99)
        children.mount(left, at: -1)
        children.mount(content, at: 99)
        XCTAssertEqual(children.views.count, 2)
        XCTAssertNil(SwipePhysics.childRoles(count: children.views.count))
        children.mount(right, at: 1)
        let roles = SwipePhysics.childRoles(count: children.views.count)!
        XCTAssertTrue(children.views[roles.left!] === left)
        XCTAssertTrue(children.views[roles.right!] === right)
        XCTAssertTrue(children.views[roles.content] === content)
        children.unmount(left, at: 0)
        XCTAssertTrue(children.views[0] === right)
        XCTAssertTrue(children.views[1] === content)
        XCTAssertNil(SwipePhysics.childRoles(count: children.views.count))
    }

    func testWidthReconciliationPreservesEnabledIntentAndDropsDisabledEdge() {
        for widths: (CGFloat, CGFloat) in [(80, 120), (120, 80), (80, 80)] {
            for side in SwipeSide.allCases {
                let open = SwipePhysics.reconcileTwoSidedState(
                    openSide: side, autoCloseState: nil,
                    leftWidth: side == .left ? widths.1 : 0,
                    rightWidth: side == .right ? widths.1 : 0,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: false
                )
                XCTAssertEqual(open.openSide, side)
                XCTAssertNil(open.autoClose)
                let closed = SwipePhysics.reconcileTwoSidedState(
                    openSide: nil, autoCloseState: nil,
                    leftWidth: widths.1, rightWidth: widths.1,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: false
                )
                XCTAssertNil(closed.openSide)
            }
        }
        for width: CGFloat in [0, -1] {
            for side in SwipeSide.allCases {
                let disabled = SwipePhysics.reconcileTwoSidedState(
                    openSide: side, autoCloseState: nil,
                    leftWidth: side == .left ? width : 120,
                    rightWidth: side == .right ? width : 120,
                    wasGestureEnabled: true, gestureEnabled: true, autoClose: false
                )
                XCTAssertNil(disabled.openSide, "Do not fall back to the enabled opposite edge")
            }
        }
    }

    func testDetachRestoresOnlySettledIntentForEitherSide() {
        for side in SwipeSide.allCases {
            XCTAssertTrue(SwipePhysics.shouldRestoreAfterDetach(hasPendingInteraction: false), side.rawValue)
            XCTAssertFalse(SwipePhysics.shouldRestoreAfterDetach(hasPendingInteraction: true), side.rawValue)
        }
    }

    func testCloseForUnboundRowClearsCachedSideBeforeFutureRestore() {
        var cache = SwipeOpenStateCache(capacity: 2)
        for side in SwipeSide.allCases {
            cache.set(side, for: "a")
            XCTAssertNil(cache.captureCloseTarget(for: "a", current: nil as SwipeCommandTarget<Child>?))
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
            }
        }
        current = nil
        queued.forEach { $0() }
        XCTAssertTrue(queued.isEmpty)
        XCTAssertEqual(cache.side(for: "a"), .right)
    }

    func testCloseAllClearsBoundAndUnboundCachedSides() {
        let mounted = Child()
        var expired: Child? = Child()
        let bindings: [String: SwipeCommandTarget<Child>] = [
            "mounted": SwipeCommandTarget(mounted),
            "expired": SwipeCommandTarget(expired!)
        ]
        expired = nil
        var cache = SwipeOpenStateCache(capacity: 4)
        cache.set(.left, for: "unmounted")
        cache.set(.right, for: "expired")
        cache.set(.right, for: "mounted")
        cache.closeAll()
        XCTAssertNil(cache.side(for: "unmounted"))
        XCTAssertNil(cache.side(for: "expired"))
        XCTAssertNotNil(bindings["mounted"]?.value)
        XCTAssertNil(cache.side(for: "mounted"), "A bound row's cached intent closes at command time too")
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
        XCTAssertNil(cache.side(for: "a"), "A bound close owns the cached intent at command time")
        let replacementMark = SwipeCloseMark()
        _ = cache.bind(replacementMark, to: "a")
        cache.persist(.right, for: "a", from: replacementMark, intent: cache.currentIntent)
        captured?.perform(ifCurrent: replacementBinding) { _ in
            XCTFail("A queued close must not operate on an A -> B -> A binding")
        }
        XCTAssertEqual(cache.side(for: "a"), .right)
    }

    func testBoundCloseIntentHoldsWhenTheKeyRebindsBeforeTheCloseRuns() {
        let view = Child()
        let mark = SwipeCloseMark()
        var cache = SwipeOpenStateCache(capacity: 2)
        _ = cache.bind(mark, to: "a")
        let openIntent = cache.currentIntent
        cache.persist(.left, for: "a", from: mark, intent: openIntent)
        let oldBinding = SwipeCommandTarget(view)
        let captured = cache.captureCloseTarget(for: "a", current: oldBinding)
        XCTAssertTrue(captured === oldBinding)
        cache.closeAll()  // closeAll in the same turn
        XCTAssertNil(cache.side(for: "a"), "A bound close owns the cached intent at command time")
        // A -> B -> A before the queued closes run: the ending binding persists its stale open.
        cache.persist(.left, for: "a", from: mark, intent: openIntent)
        _ = cache.bind(mark, to: "b")
        let replacement = SwipeCommandTarget(view)
        let restored = cache.bind(mark, to: "a")!
        XCTAssertNil(restored.side, "The new binding must not restore the pre-close side")
        cache.persist(.left, for: "a", from: mark, intent: openIntent)
        captured?.perform(ifCurrent: replacement) { _ in
            XCTFail("A queued close must not operate on an A -> B -> A binding")
        }
        XCTAssertNil(cache.side(for: "a"))
        // A later binding of the key keeps its own intent once the closes have run.
        cache.persist(.right, for: "a", from: mark, intent: restored.intent)
        XCTAssertEqual(cache.side(for: "a"), .right)
    }

    func testCloseHoldsWhenTheReplacementBindsBeforeTheOldBindingEnds() {
        for closeAll in [false, true] {
            let label = closeAll ? "closeAll" : "close(key)"
            let oldView = Child()
            let newView = Child()
            let oldMark = SwipeCloseMark()
            let newMark = SwipeCloseMark()
            var cache = SwipeOpenStateCache(capacity: 2)
            _ = cache.bind(oldMark, to: "a")
            let oldIntent = cache.currentIntent
            cache.persist(.left, for: "a", from: oldMark, intent: oldIntent)
            let oldBinding = SwipeCommandTarget(oldView)
            if closeAll {
                cache.closeAll()
            } else {
                XCTAssertTrue(cache.captureCloseTarget(for: "a", current: oldBinding) === oldBinding)
            }
            // The replacement binds the key first and reads the cache.
            let replacement = SwipeCommandTarget(newView)
            let restored = cache.bind(newMark, to: "a")!
            XCTAssertNil(restored.side, label)
            XCTAssertTrue(cache.isCurrent(restored.intent, for: newMark), label)
            // Then the old binding ends with its pre-close open side.
            cache.persist(.left, for: "a", from: oldMark, intent: oldIntent)
            XCTAssertNil(cache.side(for: "a"), label)
            oldBinding.perform(ifCurrent: replacement) { _ in XCTFail(label) }
            XCTAssertNil(cache.restore(for: "a").side, "A later binding restores closed: \(label)")
        }
    }

    func testRestoreReadBeforeTheCloseIsStale() {
        for closeAll in [false, true] {
            var cache = SwipeOpenStateCache(capacity: 2)
            let opener = SwipeCloseMark()
            _ = cache.bind(opener, to: "a")
            cache.persist(.right, for: "a", from: opener, intent: cache.currentIntent)
            // A binding reads the cache, then the close is issued before the restore applies.
            let reader = SwipeCloseMark()
            let restored = cache.bind(reader, to: "a")!
            XCTAssertEqual(restored.side, .right)
            if closeAll {
                cache.closeAll()
            } else {
                _ = cache.captureCloseTarget(for: "a", current: nil as SwipeCommandTarget<Child>?)
            }
            XCTAssertFalse(cache.isCurrent(restored.intent, for: reader))
            cache.persist(restored.side, for: "a", from: reader, intent: restored.intent)
            XCTAssertNil(cache.side(for: "a"))
        }
    }

    func testOpenAfterTheCloseCommandPersistsOpen() {
        for closeAll in [false, true] {
            let view = Child()
            let mark = SwipeCloseMark()
            var cache = SwipeOpenStateCache(capacity: 2)
            _ = cache.bind(mark, to: "a")
            let staleIntent = cache.currentIntent
            cache.persist(.left, for: "a", from: mark, intent: staleIntent)
            let binding = SwipeCommandTarget(view)
            if closeAll {
                cache.closeAll()
            } else {
                XCTAssertTrue(cache.captureCloseTarget(for: "a", current: binding) === binding)
            }
            // A later open stamps the new sequence and persists in either binding order.
            let laterIntent = cache.currentIntent
            XCTAssertTrue(cache.isCurrent(laterIntent, for: mark))
            XCTAssertFalse(cache.isCurrent(staleIntent, for: mark))
            cache.persist(.right, for: "a", from: mark, intent: laterIntent)
            XCTAssertEqual(cache.side(for: "a"), .right)
            XCTAssertEqual(cache.restore(for: "a").side, .right)
            // A close issued after that open still wins over it.
            _ = cache.captureCloseTarget(for: "a", current: binding)
            cache.persist(.right, for: "a", from: mark, intent: laterIntent)
            XCTAssertNil(cache.side(for: "a"))
        }
    }

    func testOpenIssuedAfterTheCloseCommandWinsOverTheQueuedClose() {
        for closeAll in [false, true] {
            let view = Child()
            let mark = SwipeCloseMark()
            var cache = SwipeOpenStateCache(capacity: 2)
            _ = cache.bind(mark, to: "a")
            let staleIntent = cache.currentIntent
            cache.persist(.left, for: "a", from: mark, intent: staleIntent)
            let binding = SwipeCommandTarget(view)
            if closeAll {
                cache.closeAll()
            } else {
                XCTAssertTrue(cache.captureCloseTarget(for: "a", current: binding) === binding)
            }
            let close = cache.currentIntent
            // The same binding opens again before its queued close runs.
            let laterIntent = cache.currentIntent
            cache.persist(.right, for: "a", from: mark, intent: laterIntent)
            var closed = false
            binding.perform(ifCurrent: binding) { _ in
                closed = SwipeOpenStateCache.closeApplies(close, toOpenIntent: laterIntent)
            }
            XCTAssertFalse(closed, "The later open is the latest intent")
            XCTAssertEqual(cache.side(for: "a"), .right)
            XCTAssertTrue(SwipeOpenStateCache.closeApplies(close, toOpenIntent: staleIntent))
        }
    }

    func testKeyedCloseKeepsItsEpochAfterManyOtherClosesWithPerViewMemory() {
        var cache = SwipeOpenStateCache(capacity: 2)
        let mark = SwipeCloseMark()
        _ = cache.bind(mark, to: "a")
        do {
            // A binding that is gone leaves no state after the next close.
            let gone = SwipeCloseMark()
            _ = cache.bind(gone, to: "gone")
            XCTAssertEqual(cache.trackedMarkCount, 2)
        }
        let staleIntent = cache.currentIntent
        cache.persist(.left, for: "a", from: mark, intent: staleIntent)
        // More distinct closed keys than the cache holds.
        for key in ["a", "b", "c", "d", "e"] {
            _ = cache.captureCloseTarget(for: key, current: nil as SwipeCommandTarget<Child>?)
        }
        // Keyed closes keep no per-key state: memory stays per live binding.
        XCTAssertEqual(cache.trackedMarkCount, 1)
        // The earlier close still makes the pre-close open stale.
        XCTAssertFalse(cache.isCurrent(staleIntent, for: mark))
        cache.persist(.left, for: "a", from: mark, intent: staleIntent)
        XCTAssertNil(cache.side(for: "a"))
        // An open issued after the closes stays current.
        let laterIntent = cache.currentIntent
        cache.persist(.right, for: "a", from: mark, intent: laterIntent)
        XCTAssertEqual(cache.side(for: "a"), .right)
    }

    func testNeverClosedOpenRowStaysOpenAfterMoreKeyedClosesThanTheCacheHolds() {
        var cache = SwipeOpenStateCache(capacity: 2)
        let mark = SwipeCloseMark()
        _ = cache.bind(mark, to: "a")
        let others = ["b", "c", "d", "e"].map { key -> SwipeCloseMark in
            let other = SwipeCloseMark()
            _ = cache.bind(other, to: key)
            return other
        }
        let intent = cache.currentIntent
        cache.persist(.left, for: "a", from: mark, intent: intent)
        // Closes of other keys, more than the cache holds, never stale this open.
        for key in ["b", "c", "d", "e"] {
            _ = cache.captureCloseTarget(for: key, current: nil as SwipeCommandTarget<Child>?)
        }
        XCTAssertTrue(cache.isCurrent(intent, for: mark))
        XCTAssertTrue(others.allSatisfy { !cache.isCurrent(intent, for: $0) })
        // The row ends its binding with the open side, and the next binding restores it.
        cache.persist(.left, for: "a", from: mark, intent: intent)
        _ = cache.bind(mark, to: "x")
        let restored = cache.bind(SwipeCloseMark(), to: "a")
        XCTAssertEqual(restored?.side, .left)
        XCTAssertEqual(cache.side(for: "a"), .left)
    }

    func testCloseMarksEveryBindingThatHoldsTheKey() {
        for closeAll in [false, true] {
            let label = closeAll ? "closeAll" : "close(key)"
            var cache = SwipeOpenStateCache(capacity: 4)
            let oldMark = SwipeCloseMark()
            let newMark = SwipeCloseMark()
            let otherMark = SwipeCloseMark()
            _ = cache.bind(oldMark, to: "a")
            let intent = cache.currentIntent
            // A newer binding takes the key before the older one leaves it.
            _ = cache.bind(newMark, to: "a")
            _ = cache.bind(otherMark, to: "b")
            let newView = Child()
            if closeAll {
                cache.closeAll()
            } else {
                _ = cache.captureCloseTarget(for: "a", current: SwipeCommandTarget(newView))
            }
            XCTAssertFalse(cache.isCurrent(intent, for: oldMark), label)
            XCTAssertFalse(cache.isCurrent(intent, for: newMark), label)
            XCTAssertEqual(cache.isCurrent(intent, for: otherMark), !closeAll, label)
            // The older binding cannot persist its earlier open after the newer one leaves.
            cache.persist(.left, for: "a", from: oldMark, intent: intent)
            XCTAssertNil(cache.side(for: "a"), label)
        }
    }

    func testCommandedCloseHoldsInEveryBindingOrder() {
        let orders = ["oldUnbindsFirst", "newBindsFirst", "roundTrip", "reattach"]
        for closeAll in [false, true] {
            for order in orders {
                for reopens in [false, true] {
                    let label = "\(closeAll ? "closeAll" : "close(key)") \(order) reopens=\(reopens)"
                    var cache = SwipeOpenStateCache(capacity: 4)
                    let old = SwipeCloseMark()
                    _ = cache.bind(old, to: "a")
                    var openIntent = cache.currentIntent
                    cache.persist(.left, for: "a", from: old, intent: openIntent)
                    if closeAll {
                        cache.closeAll()
                    } else {
                        _ = cache.captureCloseTarget(for: "a", current: SwipeCommandTarget(Child()))
                    }
                    // A later open on the same binding, before the queued close runs.
                    if reopens {
                        openIntent = cache.currentIntent
                        cache.persist(.left, for: "a", from: old, intent: openIntent)
                    }
                    let expected: SwipeSide? = reopens ? .left : nil
                    let restored: (side: SwipeSide?, intent: Int)
                    let holder: SwipeCloseMark
                    switch order {
                    case "oldUnbindsFirst":
                        cache.persist(.left, for: "a", from: old, intent: openIntent)
                        _ = cache.bind(old, to: "b")
                        holder = SwipeCloseMark()
                        restored = cache.bind(holder, to: "a")!
                    case "newBindsFirst":
                        holder = SwipeCloseMark()
                        restored = cache.bind(holder, to: "a")!
                        cache.persist(.left, for: "a", from: old, intent: openIntent)
                    case "roundTrip":
                        cache.persist(.left, for: "a", from: old, intent: openIntent)
                        _ = cache.bind(old, to: "b")
                        holder = old
                        restored = cache.bind(old, to: "a")!
                        cache.persist(.left, for: "a", from: old, intent: openIntent)
                    default:
                        holder = old
                        restored = cache.restore(for: "a")
                        cache.persist(.left, for: "a", from: old, intent: openIntent)
                    }
                    XCTAssertEqual(restored.side, expected, label)
                    XCTAssertTrue(cache.isCurrent(restored.intent, for: holder), label)
                    XCTAssertEqual(cache.side(for: "a"), expected, label)
                    // A later binding, after every queued command ran, restores the same.
                    XCTAssertEqual(cache.bind(SwipeCloseMark(), to: "a")?.side, expected, label)
                }
            }
        }
    }

    func testKeyedCloseLeavesOtherKeysCurrentAndCloseAllCoversUncachedKeys() {
        var cache = SwipeOpenStateCache(capacity: 4)
        let a = SwipeCloseMark()
        let b = SwipeCloseMark()
        let neverCached = SwipeCloseMark()
        _ = cache.bind(a, to: "a")
        _ = cache.bind(b, to: "b")
        _ = cache.bind(neverCached, to: "never-cached")
        let intent = cache.currentIntent
        cache.persist(.left, for: "a", from: a, intent: intent)
        cache.persist(.right, for: "b", from: b, intent: intent)
        _ = cache.captureCloseTarget(for: "a", current: nil as SwipeCommandTarget<Child>?)
        XCTAssertNil(cache.side(for: "a"))
        XCTAssertEqual(cache.side(for: "b"), .right)
        cache.persist(.left, for: "b", from: b, intent: intent)
        XCTAssertEqual(cache.side(for: "b"), .left, "A close of another key does not stale this intent")
        cache.closeAll()
        // A key that was never cached is closed by closeAll too.
        cache.persist(.left, for: "never-cached", from: neverCached, intent: intent)
        XCTAssertNil(cache.side(for: "never-cached"))
        cache.persist(.left, for: "b", from: b, intent: intent)
        XCTAssertNil(cache.side(for: "b"))
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
