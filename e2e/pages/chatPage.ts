import { BasePage } from './basePage'
import { selectors } from '../helpers/selectors'
import { swipeOnElement } from '../helpers/gestures'

const MESSAGES = [
  { id: '1', sender: 'Alice', text: 'Hey! How are you doing?' },
  { id: '2', sender: 'You', text: "I'm doing great! Just finished that project we discussed." },
  { id: '3', sender: 'Alice', text: "That's awesome! Can you send me the details?" }
]

class ChatPage extends BasePage {
  getMessageSender(index: number): string {
    return MESSAGES[index]?.sender ?? ''
  }

  async waitForDisplayed(): Promise<void> {
    await this.waitForElement(selectors.chatInput)
  }

  async isChatDemoDisplayed(): Promise<boolean> {
    return this.isDisplayed(selectors.chatDemo)
  }

  async tapChatInput(): Promise<void> {
    await this.tap(selectors.chatInput)
  }

  async isChatInputVisible(): Promise<boolean> {
    return this.isDisplayed(selectors.chatInput)
  }

  async isKeyboardShown(): Promise<boolean> {
    return driver.isKeyboardShown()
  }

  async hideKeyboard(): Promise<void> {
    if (await this.isKeyboardShown()) {
      await driver.hideKeyboard()
    }
  }

  async swipeMessage(index: number, direction: 'left' | 'right' = 'right'): Promise<void> {
    const element = await this.waitForElement(selectors.swipeableMessage(index))
    const wdElement = element as unknown as WebdriverIO.Element

    await swipeOnElement(wdElement, direction)
    await driver.pause(500)

    const okButton = await $('//*[@text="OK"]')
    const alertAppeared = await okButton.isExisting()
    if (alertAppeared) {
      throw new Error(
        'NATIVE BUG: Press event fired during swipe gesture - alert should NOT appear'
      )
    }

    await driver.pause(500)
  }

  async isReplyPreviewVisible(): Promise<boolean> {
    return this.isDisplayed(selectors.replyPreview)
  }

  async waitForReplyPreview(): Promise<void> {
    await this.waitForElement(selectors.replyPreview)
  }

  async waitForReplyPreviewWithSender(sender: string): Promise<void> {
    await this.waitForElement(selectors.replyPreview)
    await this.waitForElement(selectors.replyPreviewSender(sender))
  }

  async checkKeyboardStability(
    expectedState: boolean,
    pollCount = 5,
    intervalMs = 100
  ): Promise<boolean> {
    for (let i = 0; i < pollCount; i++) {
      const currentState = await driver.isKeyboardShown()
      if (currentState !== expectedState) {
        return false
      }
      if (i < pollCount - 1) {
        await driver.pause(intervalMs)
      }
    }
    return true
  }

  async cancelReply(): Promise<void> {
    await this.tap(selectors.replyPreviewClose)
  }

  async isReplyArrowVisible(): Promise<boolean> {
    return this.isDisplayed(selectors.replyArrow)
  }

  async typeInChat(text: string): Promise<void> {
    const element = await this.waitForElement(selectors.chatInput)
    await element.setValue(text)
  }

  async getChatInputText(): Promise<string> {
    const element = await this.waitForElement(selectors.chatInput)
    return element.getText()
  }
}

export const chatPage = new ChatPage()
