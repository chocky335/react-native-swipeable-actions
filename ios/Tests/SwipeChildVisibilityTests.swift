import XCTest
@testable import SwipeableActions

final class SwipeChildVisibilityTests: XCTestCase {
    private final class Child: SwipeChildVisibility {
        var isHidden = false
        var isUserInteractionEnabled = true
        var accessibilityElementsHidden = false
    }

    func testHiddenRailIsVisibleInteractiveAndAccessibleBeforeFabricReuse() {
        let visibility = SwipeRailVisibility()
        let child = Child()
        visibility.setRevealed(false, for: child)
        XCTAssertTrue(child.isHidden)
        XCTAssertFalse(child.isUserInteractionEnabled)
        XCTAssertTrue(child.accessibilityElementsHidden)

        visibility.release(child)
        XCTAssertFalse(child.isHidden)
        XCTAssertTrue(child.isUserInteractionEnabled)
        XCTAssertFalse(child.accessibilityElementsHidden)
    }

    func testReorderingHiddenRailIntoContentDoesNotUnhideOppositeRail() {
        let visibility = SwipeRailVisibility()
        let content = Child()
        let oppositeRail = Child()
        visibility.setRevealed(false, for: content)
        visibility.setRevealed(false, for: oppositeRail)

        visibility.release(content)
        XCTAssertFalse(content.isHidden)
        XCTAssertTrue(content.isUserInteractionEnabled)
        XCTAssertFalse(content.accessibilityElementsHidden)
        XCTAssertTrue(oppositeRail.isHidden)
        XCTAssertFalse(oppositeRail.isUserInteractionEnabled)
        XCTAssertTrue(oppositeRail.accessibilityElementsHidden)
    }

    func testReleaseAllLeavesCleanShellsForLegacyDescendants() {
        let visibility = SwipeRailVisibility()
        let left = Child()
        let right = Child()
        visibility.setRevealed(false, for: left)
        visibility.setRevealed(true, for: right)
        visibility.setRevealed(false, for: right)

        visibility.releaseAll()
        for child in [left, right] {
            XCTAssertFalse(child.isHidden)
            XCTAssertTrue(child.isUserInteractionEnabled)
            XCTAssertFalse(child.accessibilityElementsHidden)
        }
        // The former rail is now caller-owned; a later cleanup must not reset its props.
        left.isHidden = true
        visibility.releaseAll()
        XCTAssertTrue(left.isHidden)
    }

    func testRestoresOriginalCallerFlagsAcrossMultipleRevealChanges() {
        let visibility = SwipeRailVisibility()
        let child = Child()
        child.isHidden = true
        child.isUserInteractionEnabled = false
        child.accessibilityElementsHidden = true
        visibility.setRevealed(true, for: child)
        visibility.setRevealed(false, for: child)
        visibility.setRevealed(true, for: child)

        visibility.release(child)
        XCTAssertTrue(child.isHidden)
        XCTAssertFalse(child.isUserInteractionEnabled)
        XCTAssertTrue(child.accessibilityElementsHidden)

        let unownedContent = Child()
        unownedContent.isHidden = true
        visibility.release(unownedContent)
        XCTAssertTrue(unownedContent.isHidden)
    }

    func testReattachmentCapturesFreshCallerState() {
        let visibility = SwipeRailVisibility()
        let child = Child()
        visibility.setRevealed(false, for: child)
        visibility.release(child)
        child.isUserInteractionEnabled = false
        child.accessibilityElementsHidden = true

        visibility.setRevealed(true, for: child)
        visibility.release(child)
        XCTAssertFalse(child.isHidden)
        XCTAssertFalse(child.isUserInteractionEnabled)
        XCTAssertTrue(child.accessibilityElementsHidden)
    }

    func testVisibilityOwnershipDoesNotRetainRemovedChildren() {
        let visibility = SwipeRailVisibility()
        var child: Child? = Child()
        weak var weakChild = child
        visibility.setRevealed(false, for: child!)
        child = nil
        XCTAssertNil(weakChild)
        visibility.releaseAll()
    }
}
