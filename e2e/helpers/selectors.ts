/**
 * Element selectors for Appium tests
 * Supports both Android and iOS platforms
 *
 * Android: testID becomes resource-id, text uses @text
 * iOS: testID becomes name (accessibilityIdentifier), text uses @label
 */

// Detect platform - will be set by wdio before tests run
let isIOS = false

export function setPlatform(platform: string): void {
  isIOS = platform.toLowerCase() === 'ios'
}

/**
 * Create selector for testID (resource-id on Android, name on iOS)
 */
function byTestId(id: string): string {
  if (isIOS) {
    return `//*[@name="${id}"]`
  }
  return `//*[contains(@resource-id, "${id}")]`
}

/**
 * Create selector for text content
 */
function byTextAttr(text: string): string {
  if (isIOS) {
    return `//*[@label="${text}"]`
  }
  return `//*[@text="${text}"]`
}

/**
 * Create selector for text content with contains (partial match)
 */
function containsText(text: string): string {
  if (isIOS) {
    return `//*[contains(@label, "${text}")]`
  }
  return `//*[contains(@text, "${text}")]`
}

export const selectors = {
  // Config panel - using testID (all use getters for dynamic platform)
  get configHeader() {
    return byTestId('config-header')
  },
  get toggleLeading() {
    return byTestId('toggle-leading')
  },
  get selectDemoChat() {
    return byTestId('select-demo-chat')
  },
  get selectDemoList() {
    return byTestId('select-demo-list')
  },
  get selectSwipeable() {
    return byTestId('select-swipeable')
  },
  get selectRngh() {
    return byTestId('select-rngh')
  },
  get closeAllButton() {
    return byTestId('close-all-button')
  },

  // Action buttons by text
  get leaveButton() {
    return byTextAttr('Leave')
  },
  get okButton() {
    return byTextAttr('OK')
  },

  // Demo screens
  get swipeableDemo() {
    return byTextAttr('Swipeable Demo')
  },
  get chatDemo() {
    return byTestId('chat-demo')
  },

  // Chat demo
  get chatInput() {
    return byTestId('chat-input')
  },
  // 0-based index, converts to 1-based message ID internally
  swipeableMessage: (index: number) => byTestId(`swipeable-message-${index + 1}`),
  get replyPreview() {
    return byTestId('reply-preview')
  },
  get replyPreviewClose() {
    return byTestId('reply-preview-close')
  },
  // Reply preview content verification - check sender name text exists
  replyPreviewSender: (sender: string) => byTextAttr(sender),
  get replyArrow() {
    return byTextAttr('↩')
  },

  // Alert
  get alertLeft() {
    return byTextAttr('Left')
  },
  alertForItem: (index: number) => containsText(`item-${index}`),

  // Dynamic selectors for specific items
  item: (index: number) => byTextAttr(`Item ${index}`),
  swipeableRow: (index: number) => byTestId(`row-item-${index}`),
  leaveButtonForItem: (index: number) => byTestId(`leave-action-item-${index}`)
}

/**
 * Get element by accessibility ID (works on both platforms)
 */
export function byId(id: string): string {
  return `~${id}`
}

/**
 * Get element by text
 */
export function byText(text: string): string {
  return byTextAttr(text)
}

/**
 * Get element by content-desc (accessibility label)
 */
export function byContentDesc(desc: string): string {
  if (isIOS) {
    return `//*[@label="${desc}"]`
  }
  return `//*[@content-desc="${desc}"]`
}
