import { listDemoPage } from '../pages/listDemoPage'
import { configPanel } from '../pages/configPanel'
import { chatPage } from '../pages/chatPage'
import { selectors } from '../helpers/selectors'

// Configure which tests to run (empty = all tests, 0-indexed)
// prettier-ignore
const ENABLED_TESTS: number[] = process.env.ENABLED_TESTS ? process.env.ENABLED_TESTS.split(',').map(n => parseInt(n, 10)) : []

const shouldRun = (testNum: number) => ENABLED_TESTS.length === 0 || ENABLED_TESTS.includes(testNum)
const shouldRunAfterAll = () => ENABLED_TESTS.length === 0 || ENABLED_TESTS.length > 1

describe('Swipeable E2E Tests', () => {
  ;(shouldRunAfterAll() ? afterEach : () => {})(async () => {
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
      await configPanel.toggleLeadingMode()
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

      // Scroll back up to restore the row
      await mapRows(async () => {
        await listDemoPage.scrollUp()
        await expect($(selectors.leaveButtonForItem(0))).not.toBeDisplayed()
        await expect($(selectors.leaveButtonForItem(1))).not.toBeDisplayed()
      }, numberOfScrolls - 1)

      // Verify Leave button still visible (state persisted after recycling)
      await listDemoPage.scrollUp()
      // Allow time for FlashList to restore recycled cells with their cached state
      await driver.pause(1000)
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
})
