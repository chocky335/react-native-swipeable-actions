import { selectors } from '../helpers/selectors'
import { BasePage } from './basePage'

/**
 * Page object for Config Panel
 */
class ConfigPanel extends BasePage {
  /**
   * Open config panel. A slow simulator can drop a tap, so re-tap only while the
   * panel is still closed, then wait for its content.
   */
  async open(): Promise<void> {
    await this.toggleUntil(true)
  }

  /**
   * Close config panel, re-tapping only while it is still open.
   */
  async close(): Promise<void> {
    await this.toggleUntil(false)
  }

  private async toggleUntil(open: boolean): Promise<void> {
    const marker = $(selectors.selectDemoList)
    await driver.waitUntil(
      async () => {
        if ((await marker.isDisplayed()) === open) return true
        await this.tap(selectors.configHeader)
        return marker.waitForDisplayed({ timeout: 2000, reverse: !open }).then(
          () => true,
          () => false
        )
      },
      {
        timeout: 20000,
        interval: 100,
        timeoutMsg: `The config panel did not ${open ? 'open' : 'close'}`
      }
    )
  }

  /**
   * Check if close all button is visible (panel is open)
   */
  async isCloseAllVisible(): Promise<boolean> {
    return this.isDisplayed(selectors.closeAllButton)
  }

  /**
   * Enable leading (left) swipe mode
   */
  async enableLeadingMode(): Promise<void> {
    await this.tap(selectors.toggleLeadingOn)
  }

  /**
   * Disable leading mode (back to trailing/right)
   */
  async disableLeadingMode(): Promise<void> {
    await this.tap(selectors.toggleLeadingOff)
  }

  /**
   * Tap Close All button
   */
  async tapCloseAll(): Promise<void> {
    await this.tap(selectors.closeAllButton)
  }

  /**
   * Select Chat demo
   */
  async selectChatDemo(): Promise<void> {
    await this.tap(selectors.selectDemoChat)
  }

  /**
   * Select List demo
   */
  async selectListDemo(): Promise<void> {
    await this.tap(selectors.selectDemoList)
  }

  /** Select the isolated native two-sided demo. */
  async selectTwoSidedDemo(): Promise<void> {
    await this.tap(selectors.selectDemoTwoSided)
    await $(selectors.twoSidedDemo).waitForExist()
  }

  /** Select the swipe-to-go-back showcase. */
  async selectSwipeBackDemo(): Promise<void> {
    await this.tap(selectors.selectDemoSwipeBack)
    await $(selectors.swipeBackScreen).waitForExist()
  }

  /**
   * Select Native Swipeable implementation
   */
  async selectSwipeable(): Promise<void> {
    await this.tap(selectors.selectSwipeable)
  }

  /**
   * Select RNGH implementation
   */
  async selectRngh(): Promise<void> {
    await this.tap(selectors.selectRngh)
  }

  /**
   * Enable gesture
   */
  async enableGesture(): Promise<void> {
    await this.tap(selectors.toggleGestureOn)
  }

  /**
   * Disable gesture
   */
  async disableGesture(): Promise<void> {
    await this.tap(selectors.toggleGestureOff)
  }

  /**
   * Enable FlatList mode
   */
  async enableFlatList(): Promise<void> {
    await this.tap(selectors.toggleFlatListOn)
  }

  /**
   * Disable FlatList mode
   */
  async disableFlatList(): Promise<void> {
    await this.tap(selectors.toggleFlatListOff)
  }

  /**
   * Tap Simulate Reorder button (moves item-3 to top of list)
   */
  async tapSimulateReorder(): Promise<void> {
    await this.tap(selectors.simulateReorderButton)
  }

  /**
   * Tap Reset All (exercises instance ref close(false) on every row)
   */
  async tapResetAll(): Promise<void> {
    await this.tap(selectors.resetAllButton)
  }

  /**
   * Set threshold to 0.2
   */
  async setThresholdLow(): Promise<void> {
    await this.tap(selectors.setThresholdLow)
  }

  /**
   * Set threshold to 0.4 (default)
   */
  async setThresholdMedium(): Promise<void> {
    await this.tap(selectors.setThresholdMedium)
  }

  /**
   * Set threshold to 0.7
   */
  async setThresholdHigh(): Promise<void> {
    await this.tap(selectors.setThresholdHigh)
  }

  /**
   * Set dragOffsetFromEdge to 0 (default)
   */
  async setDragOffsetZero(): Promise<void> {
    await this.tap(selectors.setOffsetZero)
  }

  /**
   * Set dragOffsetFromEdge to 50 (high)
   */
  async setDragOffsetHigh(): Promise<void> {
    await this.tap(selectors.setOffsetHigh)
  }

  /**
   * Tap Run Benchmark button
   */
  async tapRunBenchmark(): Promise<void> {
    await this.tap(selectors.runBenchmarkButton)
  }
}

export const configPanel = new ConfigPanel()
