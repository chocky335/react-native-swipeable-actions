import { BasePage } from './basePage'
import { selectors } from '../helpers/selectors'
import { scrollDown, scrollUp, swipeOnElement } from '../helpers/gestures'

class ListDemoPage extends BasePage {
  async waitForDisplayed(): Promise<void> {
    await this.waitForElement(selectors.swipeableDemo)
  }

  async isListDemoDisplayed(): Promise<boolean> {
    return this.isDisplayed(selectors.swipeableDemo)
  }

  async swipeRowOpen(index: number, direction: 'left' | 'right' = 'left'): Promise<void> {
    const selector = selectors.swipeableRow(index)
    const element = await $(selector)
    await swipeOnElement(element as unknown as WebdriverIO.Element, direction)
    await driver.pause(500)
    const okButton = await $('//*[@text="OK"]')
    const alertAppeared = await okButton.isExisting()
    if (alertAppeared) {
      throw new Error(
        'NATIVE BUG: Press event fired during swipe gesture - alert should NOT appear'
      )
    }
  }

  async swipeRowClose(index: number, direction: 'left' | 'right' = 'left'): Promise<void> {
    await this.swipeRowOpen(index, direction === 'left' ? 'right' : 'left')
  }

  async isLeaveButtonVisible(): Promise<boolean> {
    return this.isDisplayed(selectors.leaveButton)
  }

  async isLeaveButtonVisibleForItem(index: number): Promise<boolean> {
    return this.isDisplayed(selectors.leaveButtonForItem(index))
  }

  leaveButtonSelector(index: number): string {
    return selectors.leaveButtonForItem(index)
  }

  async tapLeaveAction(index: number): Promise<void> {
    await this.tap(selectors.leaveButtonForItem(index))
  }

  async dismissAlert(index: number): Promise<void> {
    await this.waitForElement(selectors.alertForItem(index))
    await this.tap(selectors.okButton)
  }

  async isItemVisible(index: number): Promise<boolean> {
    return this.isDisplayed(selectors.item(index))
  }

  async scrollDown(): Promise<void> {
    await scrollDown()
  }

  async scrollUp(): Promise<void> {
    await scrollUp()
  }
}

export const listDemoPage = new ListDemoPage()
