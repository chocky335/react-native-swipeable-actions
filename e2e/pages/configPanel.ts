import { BasePage } from './basePage'
import { selectors } from '../helpers/selectors'

/**
 * Page object for Config Panel
 */
class ConfigPanel extends BasePage {
  /**
   * Open config panel
   */
  async open(): Promise<void> {
    await this.tap(selectors.configHeader)
    // Wait for panel to expand
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  /**
   * Close config panel
   */
  async close(): Promise<void> {
    await this.tap(selectors.configHeader)
    // Wait for panel to collapse
    await new Promise((resolve) => setTimeout(resolve, 300))
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
}

export const configPanel = new ConfigPanel()
