import { swipeOnElement } from '../helpers/gestures'
import { after, before, beforeEach, it } from '../helpers/scoped-mocha'
import { selectors } from '../helpers/selectors'
import { configPanel } from '../pages/configPanel'

type Direction = 'LTR' | 'RTL'
type Side = 'left' | 'right'
type Tab = 'commands' | 'localization' | 'recycling'
const APP_ID = 'com.swipeabledemo.app'
const control = selectors.twoSidedControl
const label = selectors.twoSidedControlLabel
const translated = { left: '\u062a\u062b\u0628\u064a\u062a', right: '\u062d\u0630\u0641' }

async function text(selector: string): Promise<string> {
  return (await $(selector).getText()).replace(/\s+/g, ' ').trim()
}

async function openDemo(): Promise<void> {
  // A new JS/native bridge is essential: forceRTL is not a live layout toggle.
  await driver.terminateApp(APP_ID)
  await driver.activateApp(APP_ID)
  await $(selectors.configHeader).waitForDisplayed()
  if (driver.isAndroid) await driver.pause(1000)
  await $(selectors.configHeader).click()
  await $(selectors.selectDemoTwoSided).waitForDisplayed()
  await configPanel.selectTwoSidedDemo()
  await $(selectors.configHeader).click()
  await $(selectors.selectDemoTwoSided).waitForDisplayed({ reverse: true })
  await $(selectors.twoSidedRow(0)).waitForDisplayed()
}

async function showControls(): Promise<void> {
  if ((await text(label('toggle-controls'))) === 'Show controls') {
    await $(control('toggle-controls')).click()
  }
  await $(selectors.twoSidedControls).waitForDisplayed()
}

async function hideControls(): Promise<void> {
  if ((await text(label('toggle-controls'))) === 'Hide controls') {
    await $(control('toggle-controls')).click()
  }
  await $(selectors.twoSidedControls).waitForDisplayed({ reverse: true })
}

async function selectTab(tab: Tab): Promise<void> {
  await showControls()
  await $(control(`tab-${tab}`)).click()
  const first = { commands: 'open-left', localization: 'direction-ltr', recycling: 'list-type' }
  await $(control(first[tab])).waitForExist()
}

async function scrollControls(up: boolean): Promise<void> {
  const viewport = await $(selectors.twoSidedControls)
  const origin = await driver.getElementRect(await viewport.elementId)
  const size = origin
  const x = Math.round(origin.x + size.width / 2)
  const top = Math.round(origin.y + size.height * 0.2)
  const bottom = Math.round(origin.y + size.height * 0.8)
  await driver.performActions([
    {
      type: 'pointer',
      id: 'rtl-controls',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y: up ? top : bottom },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 450, origin: 'viewport', x, y: up ? bottom : top },
        { type: 'pause', duration: 150 },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ])
  await driver.releaseActions()
}

async function tap(name: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const viewport = await $(selectors.twoSidedControls)
    const origin = await driver.getElementRect(await viewport.elementId)
    const size = origin
    const button = await $(control(name))
    if (await button.isDisplayed()) {
      const position = await driver.getElementRect(await button.elementId)
      const dimensions = position
      const center = position.y + dimensions.height / 2
      if (center > origin.y + 4 && center < origin.y + size.height - 4) {
        await button.click()
        return
      }
      await scrollControls(center < origin.y)
    } else {
      await scrollControls(false)
    }
  }
  throw new Error(`RTL control ${name} is outside the viewport`)
}

async function command(name: string): Promise<void> {
  await selectTab('commands')
  await tap(name)
}

async function setLanguage(language: 'en' | 'ar'): Promise<void> {
  await selectTab('localization')
  await tap('language')
  await expect($(label('language'))).toHaveText(`Labels: ${language}`)
}

async function assertDirection(direction: Direction): Promise<void> {
  await selectTab('localization')
  await expect($(control('direction-active'))).toHaveText(direction)
  // Check actual Yoga layout too, not just a JS isRTL label.
  const first = await $(control('direction-first')).getLocation()
  const second = await $(control('direction-second')).getLocation()
  if (direction === 'RTL') expect(first.x).toBeGreaterThan(second.x)
  else expect(first.x).toBeLessThan(second.x)
}

async function requestDirection(direction: Direction): Promise<void> {
  await selectTab('localization')
  const active = await text(control('direction-active'))
  await tap(`direction-${direction.toLowerCase()}`)
  await expect($(control('direction-request'))).toHaveText(`Restart required: ${direction}`)
  // The demo must not pretend that a preference write changes the running root.
  await expect($(control('direction-active'))).toHaveText(active)
}

async function geometry(id = 0) {
  const frame = await $(selectors.twoSidedFrame(id))
  const anchor = await $(selectors.twoSidedAnchor(id))
  const origin = await driver.getElementRect(await frame.elementId)
  const size = origin
  const marker = await driver.getElementRect(await anchor.elementId)
  const markerSize = marker
  const match = (await text(selectors.twoSidedLayout(id))).match(/Row width (\d+)/)
  const layoutWidth = Number(match?.[1])
  if (!(layoutWidth > 0)) throw new Error(`RTL row ${id} has not laid out`)
  return {
    origin,
    size,
    scale: size.width / layoutWidth,
    offset: marker.x + markerSize.width / 2 - origin.x - size.width / 2
  }
}

async function waitOffset(offset: number, id = 0): Promise<void> {
  await driver.waitUntil(
    async () => {
      const current = await geometry(id)
      return Math.abs(current.offset / current.scale - offset) <= 3
    },
    { timeout: 10000, interval: 100, timeoutMsg: `RTL row ${id} did not settle at ${offset}` }
  )
}

async function expectEnd(side: Side, state: 'open' | 'closed', id = 0): Promise<void> {
  await expect($(selectors.twoSidedLastEnd(id))).toHaveText(`${side}:${state}`)
}

async function assertPhysicalAction(side: Side, width: number, id = 0): Promise<void> {
  const button = await $(selectors.twoSidedAction(id, side))
  await button.waitForDisplayed()
  const frame = await geometry(id)
  const position = await driver.getElementRect(await button.elementId)
  const size = position
  const left =
    side === 'left' ? frame.origin.x : frame.origin.x + frame.size.width - width * frame.scale
  const right = left + width * frame.scale
  expect(position.x).toBeGreaterThanOrEqual(left - 3 * frame.scale)
  expect(position.x + size.width).toBeLessThanOrEqual(right + 3 * frame.scale)
  expect(size.width / frame.scale).toBeGreaterThanOrEqual(44)
}

async function swipe(side: Side): Promise<void> {
  await hideControls()
  const frame = await $(selectors.twoSidedFrame(0))
  await swipeOnElement(
    frame as unknown as WebdriverIO.Element,
    side === 'left' ? 'right' : 'left',
    600,
    0.7
  )
}

describe('Global direction and live translated labels', () => {
  let original: Direction | undefined

  before(async () => {
    await openDemo()
    await selectTab('localization')
    const active = await text(control('direction-active'))
    if (active !== 'LTR' && active !== 'RTL') throw new Error(`Unknown global direction: ${active}`)
    original = active
  })

  after(async () => {
    if (original === undefined) return // No global preference has been changed yet.
    // Mocha runs this after failed tests/hooks too. Restoration failures are hook
    // failures, never swallowed or reported as a passing direction test.
    await openDemo()
    await requestDirection(original)
    await openDemo()
    await assertDirection(original)
  })

  for (const direction of ['LTR', 'RTL'] as const) {
    describe(direction, () => {
      before(async () => {
        await openDemo()
        await requestDirection(direction)
        await openDemo()
        await assertDirection(direction)
      })

      beforeEach(async () => {
        await openDemo()
        await assertDirection(direction)
        await waitOffset(0)
      })

      for (const side of ['left', 'right'] as const) {
        const width = side === 'left' ? 80 : 120
        const offset = side === 'left' ? width : -width
        const expectedPresses =
          side === 'left'
            ? 'Left 1; right 0; more 0; legacy 0'
            : 'Left 0; right 1; more 0; legacy 0'

        it(`gesture reveals physical ${side}, fires only that side, and keeps actions tappable`, async () => {
          await swipe(side)
          await expectEnd(side, 'open')
          await waitOffset(offset)
          await assertPhysicalAction(side, width)
          await $(selectors.twoSidedAction(0, side)).click()
          await expect($(selectors.twoSidedPresses(0))).toHaveText(expectedPresses)
          await expect($(selectors.twoSidedEvents(0))).toHaveText(
            `Start 1; end 1; left ${side === 'left' ? 1 : 0}; right ${side === 'right' ? 1 : 0}`
          )
          await command('close')
          await expectEnd(side, 'closed')
          await waitOffset(0)
          await expect($(selectors.twoSidedEvents(0))).toHaveText(
            `Start 1; end 2; left ${side === 'left' ? 2 : 0}; right ${side === 'right' ? 2 : 0}`
          )
        })

        for (const list of ['FlashList', 'FlatList'] as const) {
          it(`${list}: translated ${side} width survives live updates, rebind and detach/attach`, async () => {
            if (list === 'FlatList') {
              await selectTab('recycling')
              await tap('list-type')
              await expect($(label('list-type'))).toHaveText('List: FlatList')
              await waitOffset(0)
            }
            await command(`open-${side}`)
            await expectEnd(side, 'open')
            await waitOffset(offset)
            const instance = await text(control('instance-0'))
            const callbacks = await text(selectors.twoSidedEvents(0))
            const localizedWidth = side === 'left' ? 112 : 160
            const localizedOffset = side === 'left' ? localizedWidth : -localizedWidth
            await setLanguage('ar')
            await waitOffset(localizedOffset)
            await expect($(control('instance-0'))).toHaveText(instance)
            await expect($(selectors.twoSidedEvents(0))).toHaveText(callbacks)
            await expect($(control(`action-label-${side}-0`))).toHaveText(translated[side])
            await assertPhysicalAction(side, localizedWidth)
            await assertDirection(direction)

            await selectTab('recycling')
            await tap('rebind')
            await $(selectors.twoSidedRow(100)).waitForDisplayed()
            await $(selectors.twoSidedRow(0)).waitForExist({ reverse: true })
            await waitOffset(0, 100)
            await expect($(selectors.twoSidedEvents(100))).toHaveText(
              'Start 0; end 0; left 0; right 0'
            )
            await tap('rebind')
            await $(selectors.twoSidedRow(0)).waitForDisplayed()
            await waitOffset(localizedOffset)
            await expect($(selectors.twoSidedEvents(0))).toHaveText(callbacks)
            await expect($(control(`action-label-${side}-0`))).toHaveText(translated[side])
            await tap('attach')
            await $(selectors.twoSidedList).waitForExist({ reverse: true })
            await tap('attach')
            await $(selectors.twoSidedList).waitForDisplayed()
            await waitOffset(localizedOffset)
            await expect($(selectors.twoSidedEvents(0))).toHaveText(callbacks)
            await assertPhysicalAction(side, localizedWidth)
            await $(selectors.twoSidedAction(0, side)).click()
            await expect($(selectors.twoSidedPresses(0))).toHaveText(expectedPresses)

            const restoredInstance = await text(control('instance-0'))
            await setLanguage('en')
            await waitOffset(offset)
            await expect($(control('instance-0'))).toHaveText(restoredInstance)
            await expect($(control(`action-label-${side}-0`))).toHaveText(
              side === 'left' ? 'Pin' : 'Del'
            )
            await expect($(selectors.twoSidedEvents(0))).toHaveText(callbacks)
            await command('close-all')
            await expectEnd(side, 'closed')
            await waitOffset(0)
          })
        }
      }

      it('legacy-only right actions retain gesture, command and translated-width behavior', async () => {
        await selectTab('localization')
        await tap('legacy-only')
        await expect($(label('legacy-only'))).toHaveText('Legacy only: on')
        await swipe('right')
        await expectEnd('right', 'open')
        await waitOffset(-120)
        await assertPhysicalAction('right', 120)
        await $(selectors.twoSidedAction(0, 'right')).click()
        await expect($(selectors.twoSidedPresses(0))).toHaveText(
          'Left 0; right 1; more 0; legacy 0'
        )
        const instance = await text(control('instance-0'))
        await setLanguage('ar')
        await waitOffset(-160)
        await expect($(control('instance-0'))).toHaveText(instance)
        await expect($(control('action-label-right-0'))).toHaveText(translated.right)
        await expect($(selectors.twoSidedEvents(0))).toHaveText('Start 1; end 1; left 0; right 1')
        await command('close')
        await expectEnd('right', 'closed')
        await waitOffset(0)
        await command('open-preferred')
        await expectEnd('right', 'open')
        await waitOffset(-160)
        await assertPhysicalAction('right', 160)
        await expect($(selectors.twoSidedEvents(0))).toHaveText('Start 1; end 3; left 0; right 3')
      })
    })
  }
})
