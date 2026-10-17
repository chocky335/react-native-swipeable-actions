import { swipeOnElement, swipeOnElementInLayoutUnits } from '../helpers/gestures'
import { beforeEach, it } from '../helpers/scoped-mocha'
import { selectors } from '../helpers/selectors'
import { relaunchApp } from '../helpers/touch-readiness'
import { configPanel } from '../pages/configPanel'

const APP_ID = 'com.swipeabledemo.app'
const LIST_SUBTITLE = 'List • Swipeable'
const SWIPE_BACK_SUBTITLE = 'Swipe to go back / Native Swipeable'
// Device pixels on Android, points on iOS.
const REST_TOLERANCE = 8
// Well below the 40% threshold of the full-width rail on any phone, and slow
// enough that the release velocity cannot project it past the threshold.
const SHORT_DRAG = 80
const SHORT_DRAG_DURATION = 800

type Rect = { x: number; y: number; width: number; height: number }

async function rectOf(selector: string): Promise<Rect> {
  return driver.getElementRect(await $(selector).elementId)
}

// The title's distance from the screen's left edge grows while the content slides right.
async function contentOffset(): Promise<number> {
  const screen = await rectOf(selectors.swipeBackScreen)
  const title = await rectOf(selectors.swipeBackTitle)
  return title.x - screen.x
}

// Wait for the push transition to finish, then return the resting content offset.
async function waitForSettledScreen(): Promise<number> {
  let previous: Rect | undefined
  await driver.waitUntil(
    async () => {
      const current = await rectOf(selectors.swipeBackScreen)
      const settled =
        previous !== undefined &&
        Math.abs(current.x) <= 1 &&
        current.x === previous.x &&
        current.y === previous.y
      previous = current
      return settled
    },
    { timeout: 10000, interval: 100, timeoutMsg: 'The swipe-back screen did not settle' }
  )
  return contentOffset()
}

async function waitForRest(restOffset: number): Promise<void> {
  await driver.waitUntil(
    async () => Math.abs((await contentOffset()) - restOffset) <= REST_TOLERANCE,
    { timeout: 10000, interval: 100, timeoutMsg: 'The content did not snap back to rest' }
  )
}

async function openConfigPanel(): Promise<void> {
  // A relaunched Android Activity can show before it accepts touches.
  // Retry the tap only while the panel is still closed.
  await driver.waitUntil(
    async () => {
      if (!(await $(selectors.selectDemoSwipeBack).isDisplayed())) {
        await $(selectors.configHeader).click()
      }
      return $(selectors.selectDemoSwipeBack)
        .waitForDisplayed({ timeout: 2000 })
        .then(
          () => true,
          () => false
        )
    },
    { timeout: 20000, interval: 100, timeoutMsg: 'The config panel did not open' }
  )
}

async function expectStillOnScreen(restOffset: number): Promise<void> {
  await waitForRest(restOffset)
  await expect($(selectors.swipeBackScreen)).toBeDisplayed()
  await expect($(selectors.headerSubtitle(SWIPE_BACK_SUBTITLE))).toBeDisplayed()
}

describe('Swipe to go back', () => {
  let restOffset = 0

  beforeEach(async () => {
    await relaunchApp(APP_ID)
    await $(selectors.configHeader).waitForDisplayed()
    await openConfigPanel()
    await configPanel.selectSwipeBackDemo()
    await $(selectors.configHeader).click()
    await $(selectors.selectDemoSwipeBack).waitForDisplayed({ reverse: true })
    await $(selectors.swipeBackTitle).waitForDisplayed()
    restOffset = await waitForSettledScreen()
    await expect($(selectors.headerSubtitle(SWIPE_BACK_SUBTITLE))).toBeDisplayed()
  })

  it('a full right swipe goes back to the previous screen', async () => {
    await swipeOnElement(await $(selectors.swipeBackScreen).getElement(), 'right')

    await $(selectors.swipeBackScreen).waitForExist({ reverse: true })
    await $(selectors.swipeableRow(0)).waitForDisplayed()
    await $(selectors.headerSubtitle(LIST_SUBTITLE)).waitForDisplayed()
  })

  it('an unsaved draft blocks the swipe, and the screen stays', async () => {
    await $(selectors.swipeBackDraft).click()
    await expect($(selectors.swipeBackDraftLabel)).toHaveText('Unsaved draft: on')
    await expect($(selectors.swipeBackBlocked)).not.toExist()

    await swipeOnElement(await $(selectors.swipeBackScreen).getElement(), 'right')

    await expect($(selectors.swipeBackBlocked)).toHaveText('Back blocked: unsaved draft')
    await expectStillOnScreen(restOffset)
    await expect($(selectors.swipeBackBlocked)).toBeDisplayed()
  })

  it('a short drag snaps back without going back', async () => {
    await swipeOnElementInLayoutUnits(
      await $(selectors.swipeBackScreen).getElement(),
      'right',
      SHORT_DRAG_DURATION,
      SHORT_DRAG
    )

    await expectStillOnScreen(restOffset)
    await expect($(selectors.swipeBackBlocked)).not.toExist()
  })
})
