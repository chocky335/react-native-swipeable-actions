/**
 * Base page object with common methods
 */
export class BasePage {
  /**
   * Wait for element to be displayed
   */
  async waitForElement(selector: string): Promise<WebdriverIO.Element> {
    const element = await $(selector)
    await element.waitForDisplayed()
    return element
  }

  /**
   * Check if element is displayed
   */
  async isDisplayed(selector: string): Promise<boolean> {
    try {
      const element = await $(selector)
      return await element.isDisplayed()
    } catch {
      return false
    }
  }

  /**
   * Tap on element
   */
  async tap(selector: string): Promise<void> {
    const element = await this.waitForElement(selector)
    await element.click()
  }

  /**
   * Wait for element to not be displayed
   */
  async waitForNotDisplayed(selector: string): Promise<void> {
    const element = await $(selector)
    await element.waitForDisplayed({ reverse: true })
  }
}
