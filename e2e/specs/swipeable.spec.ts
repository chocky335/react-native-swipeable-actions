import { scrollUpUntilDisplayed, swipeOnElement } from '../helpers/gestures'
import { compareImages, takeViewportScreenshot } from '../helpers/screenshot'
import { selectors } from '../helpers/selectors'
import { chatPage } from '../pages/chatPage'
import { configPanel } from '../pages/configPanel'
import { listDemoPage } from '../pages/listDemoPage'

// Configure which tests to run (empty = all tests, 0-indexed)
// prettier-ignore
const ENABLED_TESTS: number[] = process.env.ENABLED_TESTS
  ? process.env.ENABLED_TESTS.split(',').map((n) => parseInt(n, 10))
  : []

const shouldRun = (testNum: number) => ENABLED_TESTS.length === 0 || ENABLED_TESTS.includes(testNum)
describe('Swipeable E2E Tests', () => {
  afterEach(async () => {
    const appId = 'com.swipeabledemo.app'
    await driver.terminateApp(appId)
    await driver.activateApp(appId)
    await listDemoPage.waitForDisplayed()
  })
  const numberOfRows = 5
  const mapRows = async (
    callback: (index: number) => Promise<void>,
    _numberOfRows: number = numberOfRows
  ) => {
    for (let index = 0; index < _numberOfRows; index++) {
      await callback(index)
    }
  }
  const testSwipeOpen = async (numberOfRows: number, direction?: 'left' | 'right') =>
    mapRows(async (index) => {
      await expect($(selectors.swipeableRow(index))).toBeDisplayed()
      await expect($(selectors.leaveButtonForItem(index))).not.toBeDisplayed()
      await listDemoPage.swipeRowOpen(index, direction)
      await expect($(selectors.leaveButtonForItem(index))).toBeDisplayed()
    }, numberOfRows)

  const testSwipeClose = async (numberOfRows: number, direction?: 'left' | 'right') =>
    mapRows(async (index) => {
      await listDemoPage.swipeRowClose(index, direction)
      await expect($(selectors.leaveButtonForItem(index))).not.toBeDisplayed()
    }, numberOfRows)

  const testSwipeOpenClose = async (direction?: 'left' | 'right') => {
    await testSwipeOpen(numberOfRows, direction)

    await testSwipeClose(numberOfRows, direction)
  }
  ;(shouldRun(0) ? describe : describe.skip)('Test 0: Basic Swipe Open/Close', () => {
    it('should open and close swipeable row', async () => {
      await testSwipeOpenClose('left')
    })
  })
  ;(shouldRun(1) ? describe : describe.skip)('Test 1: Swipe from left direction', () => {
    it('should swipe from left when leading mode enabled', async () => {
      await configPanel.open()
      await configPanel.enableLeadingMode()
      await configPanel.close()

      await testSwipeOpenClose('right')
    })
  })
  ;(shouldRun(2) ? describe : describe.skip)('Test 2: Swipe Action Trigger', () => {
    it('should trigger action when tapping revealed button', async () => {
      await mapRows(async (index) => {
        await listDemoPage.swipeRowOpen(index)
        await expect($(selectors.leaveButtonForItem(index))).toBeDisplayed()
        await listDemoPage.tapLeaveAction(index)
        await expect($(selectors.alertForItem(index))).toBeDisplayed()
        await listDemoPage.dismissAlert(index)
      })
    })
  })
  ;(shouldRun(3) ? describe : describe.skip)('Test 3: Ref Close API', () => {
    it('should close all rows via Close All button', async () => {
      await testSwipeOpen(numberOfRows, 'left')

      await configPanel.open()
      await configPanel.tapCloseAll()
      await configPanel.close()

      await mapRows(async (index) => {
        await expect($(selectors.leaveButtonForItem(index))).not.toBeDisplayed()
      })
    })
  })
  ;(shouldRun(4) ? describe : describe.skip)('Test 4: Recycling State Persistence', () => {
    it('should persist swipeable state through list recycling', async () => {
      const numberOfRows = 2
      await testSwipeOpen(numberOfRows)
      const numberOfScrolls = 2

      // Scroll down to recycle the row
      await mapRows(async () => {
        await listDemoPage.scrollDown()
        await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()
        await expect($(selectors.leaveButtonForItem(1))).not.toBeDisplayed()
      }, numberOfScrolls)

      // Scroll back up until item-0's row is visible. Gesture-based scrolls
      // accumulate drift, so matching the down count isn't reliable - on
      // flaky runs the list lands below the starting position. Using
      // swipeableRow(0) (the row container) as the anchor is safe because
      // it always renders when on screen, unlike leaveButtonForItem which
      // only renders when state is preserved (the behaviour we're testing).
      await scrollUpUntilDisplayed(selectors.swipeableRow(0))
      // Both rows' leave buttons should be visible now with state preserved
      // (native cache restored)
      await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()
      await expect($(selectors.leaveButtonForItem(1))).toBeDisplayed()
    })
  })
  const navigateToChat = async () => {
    await configPanel.open()
    await configPanel.selectChatDemo()
    await configPanel.close()
    await chatPage.waitForDisplayed()
    // Allow FlashList to fully render messages
    await driver.pause(1000)
  }
  ;(shouldRun(5) ? describe : describe.skip)('Test 5: AutoClose (Chat Demo)', () => {
    it('should auto-close and show correct reply preview on swipe', async () => {
      await navigateToChat()

      // Swipe on first message - should auto-close and show reply preview
      const index = 0
      const expectedSender = chatPage.getMessageSender(index)
      await chatPage.swipeMessage(index, 'right')

      // Reply preview should show correct sender (verifies correct message)
      await chatPage.waitForReplyPreviewWithSender(expectedSender)

      // Reply arrow should NOT be visible (swipeable auto-closed)
      await expect($(selectors.replyArrow)).not.toBeDisplayed()
    })
  })
  ;(shouldRun(6) ? describe : describe.skip)('Test 6: Keyboard Persistence', () => {
    it('should keep keyboard open during autoclose swipe without flicker', async () => {
      await navigateToChat()

      // Open keyboard
      await chatPage.tapChatInput()
      await driver.pause(500)
      expect(await chatPage.isKeyboardShown()).toBe(true)

      // Swipe to trigger autoclose reply
      await chatPage.swipeMessage(0, 'right')
      await chatPage.waitForReplyPreview()

      // Keyboard should stay open and stable (no flicker during swipe)
      const isStable = await chatPage.checkKeyboardStability(true)
      expect(isStable).toBe(true)
    })
  })
  ;(shouldRun(7) ? describe : describe.skip)('Test 7: CloseAll after navigation round-trip', () => {
    it('should close all rows via Close All after navigating away and back', async () => {
      // Open rows on List Demo
      await testSwipeOpen(numberOfRows, 'left')

      // Navigate to Chat Demo via React Navigation native-stack.
      // Note: native-stack destroys view Fragments on navigate-away and recreates
      // them on navigate-back, so the onAttachedToWindow re-registration path
      // is not exercised here (new view instances register via prop setter).
      // This test validates that Swipeable.closeAll() (static registry API) works
      // correctly after a full navigation lifecycle with fresh view instances.
      await configPanel.open()
      await configPanel.selectChatDemo()
      await configPanel.close()
      await chatPage.waitForDisplayed()

      // Navigate back to List Demo (new view instances created by native-stack)
      await configPanel.open()
      await configPanel.selectListDemo()
      await configPanel.close()
      await listDemoPage.waitForDisplayed()
      await driver.pause(500)

      // Close All via the static registry API (Swipeable.closeAll())
      await configPanel.open()
      await configPanel.tapCloseAll()
      await configPanel.close()

      // Verify all rows are closed
      await mapRows(async (index) => {
        await expect($(selectors.leaveButtonForItem(index))).not.toBeDisplayed()
      })
    })
  })
  ;(shouldRun(8) ? describe : describe.skip)('Test 8: Gesture disabled prevents swipe', () => {
    it('should not open swipeable when gesture is disabled', async () => {
      await configPanel.open()
      await configPanel.disableGesture()
      await configPanel.close()

      // Swipe directly — when gesture is disabled the touch falls through
      // to the child onPress handler, which may trigger an alert
      const element = await $(selectors.swipeableRow(0))
      await swipeOnElement(element as unknown as WebdriverIO.Element, 'left')
      await driver.pause(500)

      // Assert FIRST — before alert dismissal changes state
      await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()

      // Then clean up alert if present
      const okButton = await $(selectors.okButton)
      if (await okButton.isExisting()) {
        await okButton.click()
        await driver.pause(300)
      }
    })
  })
  ;(shouldRun(9) ? describe : describe.skip)('Test 9: Gesture re-enabled restores swipe', () => {
    it('should open swipeable after re-enabling gesture', async () => {
      await configPanel.open()
      await configPanel.disableGesture()
      await configPanel.close()

      // Verify disable actually works
      const element = await $(selectors.swipeableRow(0))
      await swipeOnElement(element as unknown as WebdriverIO.Element, 'left')
      await driver.pause(500)
      await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()
      // Dismiss alert if touch passed through
      const okButton = await $(selectors.okButton)
      if (await okButton.isExisting()) {
        await okButton.click()
        await driver.pause(300)
      }

      // Now re-enable and verify swipe works
      await configPanel.open()
      await configPanel.enableGesture()
      await configPanel.close()

      await listDemoPage.swipeRowOpen(0, 'left')
      await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()
    })
  })
  ;(shouldRun(10) ? describe : describe.skip)(
    'Test 10: Disable gesture while open closes row',
    () => {
      it('should close open row when gesture is disabled', async () => {
        await listDemoPage.swipeRowOpen(0, 'left')
        await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()

        await configPanel.open()
        await configPanel.disableGesture()
        await configPanel.close()

        await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()

        // Verify state is actually reset: re-enable and swipe should work cleanly
        await configPanel.open()
        await configPanel.enableGesture()
        await configPanel.close()

        await listDemoPage.swipeRowOpen(0, 'left')
        await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()
      })
    }
  )
  ;(shouldRun(11) ? describe : describe.skip)(
    'Test 11: Gesture disabled with leading actions',
    () => {
      it('should not open leading swipeable when gesture is disabled', async () => {
        await configPanel.open()
        await configPanel.enableLeadingMode()
        await configPanel.disableGesture()
        await configPanel.close()

        const element = await $(selectors.swipeableRow(0))
        await swipeOnElement(element as unknown as WebdriverIO.Element, 'right')
        await driver.pause(500)

        // Assert FIRST — before alert dismissal changes state
        await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()

        // Then clean up alert if present
        const okButton = await $(selectors.okButton)
        if (await okButton.isExisting()) {
          await okButton.click()
          await driver.pause(300)
        }
      })
    }
  )
  ;(shouldRun(12) ? describe : describe.skip)(
    'Test 12: Close All works with gesture disabled',
    () => {
      it('should close rows via API even when gesture is disabled', async () => {
        // Open rows first
        await testSwipeOpen(numberOfRows, 'left')

        // Disable gesture (closes all rows via setter)
        await configPanel.open()
        await configPanel.disableGesture()

        // Call Close All on top of already-closed rows (idempotent check)
        await configPanel.tapCloseAll()
        await configPanel.close()

        // Verify no crash and rows are closed
        await mapRows(async (index) => {
          await expect($(selectors.leaveButtonForItem(index))).not.toBeDisplayed()
        })

        // Re-enable gesture, open rows, then Close All should still work
        await configPanel.open()
        await configPanel.enableGesture()
        await configPanel.close()

        await testSwipeOpen(numberOfRows, 'left')

        await configPanel.open()
        await configPanel.tapCloseAll()
        await configPanel.close()

        await mapRows(async (index) => {
          await expect($(selectors.leaveButtonForItem(index))).not.toBeDisplayed()
        })
      })
    }
  )
  ;(shouldRun(13) ? describe : describe.skip)(
    'Test 13: CloseAll after removeClippedSubviews detach/reattach (PR #1 regression)',
    () => {
      it('should close rows via closeAll() after scrolling offscreen and back', async () => {
        // Switch to FlatList mode (removeClippedSubviews=true by default on Android)
        await configPanel.open()
        await driver.pause(500)
        await configPanel.enableFlatList()
        await configPanel.close()
        await driver.pause(500)

        // Scroll down to push items offscreen and trigger detach
        // (removeClippedSubviews → removeViewInLayout → onDetachedFromWindow → unregister)
        for (let i = 0; i < 3; i++) {
          await listDemoPage.scrollDown()
        }
        await driver.pause(500)

        // Scroll back up to trigger reattach (onAttachedToWindow)
        // With the fix: re-registers views in the registry
        // Without the fix: views remain unregistered
        for (let i = 0; i < 4; i++) {
          await listDemoPage.scrollUp()
        }
        await driver.pause(500)

        // Wait for item-0 to be visible after scrolling back
        await $(selectors.swipeableRow(0)).waitForDisplayed({ timeout: 5000 })

        // Open rows AFTER the detach/reattach cycle
        await listDemoPage.swipeRowOpen(0, 'left')
        await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()
        await listDemoPage.swipeRowOpen(1, 'left')
        await expect($(selectors.leaveButtonForItem(1))).toBeDisplayed()

        // Call closeAll() via the static registry API (Swipeable.closeAll())
        await configPanel.open()
        await configPanel.tapCloseAll()
        await configPanel.close()

        // Without the PR #1 fix: views not in registry → closeAll() no-op → rows stay open → FAIL
        // With the fix: onAttachedToWindow re-registered views → closeAll() works → PASS
        await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()
        await expect($(selectors.leaveButtonForItem(1))).not.toBeDisplayed()

        // Restore FlashList mode
        await configPanel.open()
        await configPanel.disableFlatList()
        await configPanel.close()
      })
    }
  )
  ;(shouldRun(14) ? describe : describe.skip)(
    'Test 14: Seekbar RNGH pan does not open swipeable (gesture conflict regression)',
    () => {
      it('should not reveal swipeable action when swiping seekbar track', async () => {
        // Swipe left on the seekbar track (RNGH Pan gesture area)
        const track = await $(selectors.seekbarThumb)
        await swipeOnElement(track as unknown as WebdriverIO.Element, 'left', 400, 100)
        await driver.pause(500)

        // The swipeable action should NOT be revealed
        await expect($(selectors.seekbarAction)).not.toBeDisplayed()
      })
    }
  )
  ;(shouldRun(15) ? describe : describe.skip)(
    'Test 15: Reorder while swiped open retains open state (lobby reorder regression)',
    () => {
      it('should keep swipeable open when list reorders around it', async () => {
        // Use FlatList to avoid FlashList recycling (isolate the layout bug)
        await configPanel.open()
        await configPanel.enableFlatList()
        await configPanel.close()
        await driver.pause(500)

        // Swipe item-0 open (reveal mute/leave actions)
        await listDemoPage.swipeRowOpen(0, 'left')
        await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()

        // Trigger reorder: item-3 moves to top, item-0 shifts to index 1
        // This simulates the lobby scenario where a new message bumps a room above
        await configPanel.open()
        await configPanel.tapSimulateReorder()
        await configPanel.close()

        // Wait for layout to settle after reorder
        await driver.pause(1000)

        // item-0's leave button should STILL be visible after reorder
        await expect($(selectors.leaveButtonForItem(0))).toBeDisplayed()

        // Restore FlashList mode
        await configPanel.open()
        await configPanel.disableFlatList()
        await configPanel.close()
      })
    }
  )

  // --- iOS Regression Test (Test 16) ---
  // Targets bugs introduced by commit 784dc64 that cause
  // iOS-specific rendering corruption after toggling list implementation.
  // iOS bugs (willMove not resetting transforms, onLayout clipping)
  // cause avatar numbers to vanish, colors to shift, and seekbar to disappear
  // when switching FlashList -> FlatList -> FlashList.
  ;(shouldRun(16) ? describe : describe.skip)(
    'Test 16: Visual integrity after list implementation switch (iOS layout regression)',
    () => {
      it('should render identically after FlatList round-trip toggle', async () => {
        // Wait for full render
        await $(selectors.swipeableRow(0)).waitForDisplayed({ timeout: 5000 })
        await driver.pause(300)

        // Baseline: clean app launch, status bar cropped out
        const baseline = await takeViewportScreenshot('flatlist-toggle-baseline')

        // Toggle: enable FlatList then disable (back to FlashList)
        await configPanel.open()
        await configPanel.enableFlatList()
        await configPanel.close()
        await driver.pause(500)

        await configPanel.open()
        await configPanel.disableFlatList()
        await configPanel.close()
        await driver.pause(500)

        // Post-toggle screenshot, same crop
        const afterToggle = await takeViewportScreenshot('flatlist-toggle-after')

        // Pixel-level comparison (status bar excluded, no clock diff)
        const diff = compareImages(baseline.png, afterToggle.png, 0.005)
        expect(diff.match).toBe(true)
      })
    }
  )
})
