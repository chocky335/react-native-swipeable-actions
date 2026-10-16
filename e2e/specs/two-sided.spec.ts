import { swipeOnElement } from '../helpers/gestures'
import { beforeEach, it } from '../helpers/scoped-mocha'
import { selectors } from '../helpers/selectors'
import { configPanel } from '../pages/configPanel'
import { guardRequest } from '../helpers/command-scope'
import { createFastGeometryReader } from '../helpers/fast-geometry'
import { createControlsNavigator } from '../helpers/control-navigation'

type Side = 'left' | 'right'
type Events = { starts: number; ends: number; left: number; right: number }
let fastReader: ReturnType<typeof createFastGeometryReader> | undefined
let fastControls: ReturnType<typeof createControlsNavigator> | undefined
function readIOSGeometry(id: number) {
  fastReader ??= createFastGeometryReader(driver, {
    assertOwnerActive() {
      guardRequest({})
    }
  })
  return fastReader(id)
}

const APP_ID = 'com.swipeabledemo.app'
const opposite = (side: Side): Side => (side === 'left' ? 'right' : 'left')
const directionFor = (side: Side): Side => opposite(side)

async function textOf(selector: string): Promise<string> {
  return (await $(selector).getText()).replace(/\s+/g, ' ').trim()
}

async function events(id = 0): Promise<Events> {
  const text = await textOf(selectors.twoSidedEvents(id))
  const match = text.match(/Start (\d+); end (\d+); left (\d+); right (\d+)/)
  if (!match) throw new Error(`Missing row ${id} callback counters: ${text}`)
  return {
    starts: Number(match[1]),
    ends: Number(match[2]),
    left: Number(match[3]),
    right: Number(match[4])
  }
}

async function geometry(id = 0): Promise<{ offset: number; scale: number }> {
  if (driver.isIOS) return readIOSGeometry(id)
  const frame = await $(selectors.twoSidedFrame(id))
  const anchor = await $(selectors.twoSidedAnchor(id))
  const frameLocation = await driver.getElementRect(await frame.elementId)
  const frameSize = frameLocation
  const anchorLocation = await driver.getElementRect(await anchor.elementId)
  const anchorSize = anchorLocation
  const match = (await textOf(selectors.twoSidedLayout(id))).match(/Row width (\d+)/)
  const layoutWidth = Number(match?.[1])
  if (!(layoutWidth > 0)) throw new Error(`Row ${id} has not laid out`)
  // Appium uses device pixels on Android and points on iOS. Derive the scale
  // from actual RN layout, without native diagnostic commands or fixed density.
  return {
    offset: anchorLocation.x + anchorSize.width / 2 - frameLocation.x - frameSize.width / 2,
    scale: frameSize.width / layoutWidth
  }
}

async function waitOffset(id: number, offset: number): Promise<void> {
  await driver.waitUntil(
    async () => {
      const actual = await geometry(id)
      return Math.abs(actual.offset / actual.scale - offset) <= 3
    },
    {
      timeout: 10000,
      interval: 100,
      timeoutMsg: `Row ${id} did not settle at ${offset} layout units`
    }
  )
}

async function waitEnd(id: number, side: Side, state: 'open' | 'closed'): Promise<void> {
  await expect($(selectors.twoSidedLastEnd(id))).toHaveText(`${side}:${state}`)
}

async function showControls(): Promise<void> {
  if ((await textOf(selectors.twoSidedControlLabel('toggle-controls'))) === 'Show controls') {
    await $(selectors.twoSidedControl('toggle-controls')).click()
  }
  await $(selectors.twoSidedControls).waitForDisplayed()
}

async function hideControls(): Promise<void> {
  if ((await textOf(selectors.twoSidedControlLabel('toggle-controls'))) === 'Hide controls') {
    await $(selectors.twoSidedControl('toggle-controls')).click()
  }
  await $(selectors.twoSidedControls).waitForDisplayed({ reverse: true })
}

async function showReorderedRows(): Promise<void> {
  await hideControls()
  // The demo disables FlashList anchoring so the new first row stays onscreen.
  // Wait for both actual frames before inspecting geometry or restored actions.
  // Missing native content still fails the subsequent anchor/action assertions.
  await $(selectors.twoSidedFrame(1)).waitForDisplayed()
  await $(selectors.twoSidedFrame(0)).waitForDisplayed()
}

async function selectTab(tab: 'commands' | 'options' | 'recycling'): Promise<void> {
  await showControls()
  await $(selectors.twoSidedControl(`tab-${tab}`)).click()
  const first = { commands: 'open-left', options: 'left-enabled', recycling: 'list-type' }
  await $(selectors.twoSidedControl(first[tab])).waitForDisplayed()
}

async function scrollWithin(selector: string, direction: 'up' | 'down'): Promise<void> {
  const viewport = await $(selector)
  const location = await driver.getElementRect(await viewport.elementId)
  const size = location
  const x = Math.round(location.x + size.width / 2)
  const top = Math.round(location.y + size.height * 0.2)
  const bottom = Math.round(location.y + size.height * 0.8)
  await driver.performActions([
    {
      type: 'pointer',
      id: 'two-sided-scroll',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y: direction === 'down' ? bottom : top },
        { type: 'pointerDown', button: 0 },
        {
          type: 'pointerMove',
          duration: 450,
          origin: 'viewport',
          x,
          y: direction === 'down' ? top : bottom
        },
        { type: 'pause', duration: 150 },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ])
  await driver.releaseActions()
}

async function tapControl(name: string): Promise<void> {
  // The iOS suite explicitly uses XCUITest expanded native observations.
  if (driver.isIOS) {
    fastControls ??= createControlsNavigator(driver, {
      assertOwnerActive() {
        guardRequest({})
      },
      element: async (selector) => $(selector).getElement(),
      controlSelector: selectors.twoSidedControl,
      controlsSelector: selectors.twoSidedControls
    })
    return fastControls(name)
  }
  // Controls wrap with large text and scroll independently of the demo rows.
  for (let attempt = 0; attempt < 10; attempt++) {
    const viewport = await $(selectors.twoSidedControls)
    const origin = await driver.getElementRect(await viewport.elementId)
    const size = origin
    const button = await $(selectors.twoSidedControl(name))
    if (await button.isDisplayed()) {
      const position = await driver.getElementRect(await button.elementId)
      const buttonSize = position
      const center = position.y + buttonSize.height / 2
      if (center > origin.y + 4 && center < origin.y + size.height - 4) {
        await button.click()
        return
      }
      await scrollWithin(selectors.twoSidedControls, center < origin.y ? 'up' : 'down')
    } else {
      await scrollWithin(selectors.twoSidedControls, 'down')
    }
  }
  throw new Error(`Control ${name} did not become visible`)
}

async function command(name: string): Promise<void> {
  await selectTab('commands')
  await tapControl(name)
}

async function option(name: string, label: string): Promise<void> {
  await selectTab('options')
  await tapControl(name)
  await expect($(selectors.twoSidedControlLabel(name))).toHaveText(label)
}

async function swipeRow(id: number, direction: Side, distance = 0.7): Promise<void> {
  await hideControls()
  const row = await $(selectors.twoSidedFrame(id))
  await row.waitForDisplayed()
  await swipeOnElement(row as unknown as WebdriverIO.Element, direction, 600, distance)
}

async function expectQuietClosed(id: number, expected: Events): Promise<void> {
  const started = Date.now()
  let changed = false
  // A negative command/gesture needs a bounded observation window. Every poll
  // observes both native position and completion counters; no fixed sleeps.
  await driver.waitUntil(
    async () => {
      const actual = await geometry(id)
      const current = await events(id)
      changed ||=
        Math.abs(actual.offset / actual.scale) > 3 ||
        JSON.stringify(current) !== JSON.stringify(expected)
      return !changed && Date.now() - started >= 600
    },
    { timeout: 2500, interval: 100, timeoutMsg: `Disabled interaction changed row ${id}` }
  )
}

async function reverseThroughZero(side: Side): Promise<void> {
  await hideControls()
  const row = await $(selectors.twoSidedFrame(0))
  const location = await driver.getElementRect(await row.elementId)
  const size = location
  const centerX = Math.round(location.x + size.width / 2)
  const y = Math.round(location.y + size.height / 2)
  const distance = Math.round(size.width * 0.32)
  const sign = side === 'left' ? 1 : -1
  // One pointer stays down from closed, past an opening threshold, then back
  // through zero toward the other edge. Ordinary one-way drags use swipeOnElement.
  await driver.performActions([
    {
      type: 'pointer',
      id: 'two-sided-reversal',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: centerX, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 500, origin: 'viewport', x: centerX + sign * distance, y },
        { type: 'pointerMove', duration: 800, origin: 'viewport', x: centerX - sign * distance, y },
        { type: 'pause', duration: 150 },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ])
  await driver.releaseActions()
}

describe('Two-sided native demo', () => {
  beforeEach(async () => {
    await driver.terminateApp(APP_ID)
    await driver.activateApp(APP_ID)
    await $(selectors.configHeader).waitForDisplayed()
    if (driver.isAndroid) {
      // Accessibility can expose the new Activity before its launch transition
      // accepts touches. Keep system animations enabled and settle before the
      // first tap; swipe assertions and their timeouts remain unchanged.
      await driver.pause(1000)
    }
    await $(selectors.configHeader).click()
    await $(selectors.selectDemoTwoSided).waitForDisplayed()
    await configPanel.selectTwoSidedDemo()
    await $(selectors.configHeader).click()
    await $(selectors.selectDemoTwoSided).waitForDisplayed({ reverse: true })
    await $(selectors.twoSidedRow(0)).waitForDisplayed()
    await waitOffset(0, 0)
  })

  for (const api of ['ref', 'static'] as const) {
    for (const side of ['left', 'right'] as const) {
      it(`${api}: first programmatic ${side} open mounts tappable actions before any drag`, async () => {
        await expect($(selectors.twoSidedAction(0, 'left'))).not.toExist()
        await expect($(selectors.twoSidedAction(0, 'right'))).not.toExist()
        const prefix = api === 'ref' ? 'open' : 'static'
        await command(`${prefix}-${side}`)
        await waitEnd(0, side, 'open')
        await waitOffset(0, side === 'left' ? 80 : -120)
        await expect($(selectors.twoSidedActions(0, side))).toBeDisplayed()
        await $(selectors.twoSidedAction(0, side)).click()
        await expect($(selectors.twoSidedPresses(0))).toHaveText(
          side === 'left'
            ? 'Left 1; right 0; more 0; alternate 0'
            : 'Left 0; right 1; more 0; alternate 0'
        )
        expect(await events()).toEqual({
          starts: 0,
          ends: 1,
          left: side === 'left' ? 1 : 0,
          right: side === 'right' ? 1 : 0
        })

        const next = opposite(side)
        await command(`${prefix}-${next}`)
        await waitEnd(0, next, 'open')
        await waitOffset(0, next === 'left' ? 80 : -120)
        await expect($(selectors.twoSidedAction(0, side))).not.toBeDisplayed()
        await $(selectors.twoSidedAction(0, next)).click()
        await expect($(selectors.twoSidedPresses(0))).toHaveText(
          'Left 1; right 1; more 0; alternate 0'
        )
        expect(await events()).toEqual({
          starts: 0,
          ends: 3,
          left: side === 'left' ? 2 : 1,
          right: side === 'right' ? 2 : 1
        })

        await command('close')
        await waitEnd(0, next, 'closed')
        await waitOffset(0, 0)
        await command(`${prefix}-${side}`)
        await waitEnd(0, side, 'open')
        await command('instant-close')
        await waitOffset(0, 0)
        await expect($(selectors.twoSidedAction(0, side))).not.toBeDisplayed()
      })
    }
  }

  it('open() prefers right, then the only enabled left edge', async () => {
    await command('open-preferred')
    await waitEnd(0, 'right', 'open')
    await waitOffset(0, -120)
    await command('close')
    await waitEnd(0, 'right', 'closed')
    await option('right-enabled', 'Right: disabled')
    await command('open-preferred')
    await waitEnd(0, 'left', 'open')
    await waitOffset(0, 80)
  })

  it('explicit false disables alternate right content and explicit disabled opens never choose left', async () => {
    // The retained technical control ID now selects explicit content, never fallback props.
    await option('mixed', 'Alternate explicit content: on')
    await command('open-right')
    await waitEnd(0, 'right', 'open')
    await waitOffset(0, -120)
    await expect($(selectors.twoSidedAction(0, 'legacy'))).toBeDisplayed()
    await expect($(selectors.twoSidedAction(0, 'right'))).not.toExist()
    await option('right-enabled', 'Right: disabled')
    await waitOffset(0, 0)
    const baseline = await events()
    await command('static-right')
    await expectQuietClosed(0, baseline)
    await command('open-right')
    await expectQuietClosed(0, baseline)
    await swipeRow(0, 'left')
    await expectQuietClosed(0, baseline)
    await expect($(selectors.twoSidedAction(0, 'legacy'))).not.toBeDisplayed()
    await command('open-left')
    await waitEnd(0, 'left', 'open')
    await waitOffset(0, 80)
    await $(selectors.twoSidedAction(0, 'left')).click()
    await expect($(selectors.twoSidedPresses(0))).toHaveText('Left 1; right 0; more 0; alternate 0')
  })

  it('explicit null disables left without opening right, and both edges can be disabled', async () => {
    await option('left-enabled', 'Left: disabled')
    const baseline = await events()
    await command('open-left')
    await expectQuietClosed(0, baseline)
    await command('static-left')
    await expectQuietClosed(0, baseline)
    await swipeRow(0, 'right')
    await expectQuietClosed(0, baseline)
    await option('right-enabled', 'Right: disabled')
    await command('open-preferred')
    await expectQuietClosed(0, baseline)
    await swipeRow(0, 'left')
    await expectQuietClosed(0, baseline)
  })

  it('gesture disable prevents both drags while leaving explicit commands usable', async () => {
    await option('gesture', 'Gesture: off')
    const baseline = await events()
    await swipeRow(0, 'left')
    await expectQuietClosed(0, baseline)
    await swipeRow(0, 'right')
    await expectQuietClosed(0, baseline)
    await command('open-left')
    await waitEnd(0, 'left', 'open')
    await waitOffset(0, 80)
  })

  for (const side of ['left', 'right'] as const) {
    it(`${side}: a closed-start gesture cannot change sides while the same pointer stays down`, async () => {
      await reverseThroughZero(side)
      await waitEnd(0, side, 'closed')
      await waitOffset(0, 0)
      expect(await events()).toEqual({
        starts: 1,
        ends: 1,
        left: side === 'left' ? 1 : 0,
        right: side === 'right' ? 1 : 0
      })
      await expect($(selectors.twoSidedAction(0, opposite(side)))).not.toBeDisplayed()
      await swipeRow(0, side)
      await waitEnd(0, opposite(side), 'open')
      await waitOffset(0, side === 'left' ? -120 : 80)
    })

    it(`${side}: closing across zero stays latched until the next gesture`, async () => {
      await swipeRow(0, directionFor(side))
      await waitEnd(0, side, 'open')
      await waitOffset(0, side === 'left' ? 80 : -120)
      await swipeRow(0, side, 0.8)
      await waitEnd(0, side, 'closed')
      await waitOffset(0, 0)
      await expect($(selectors.twoSidedAction(0, opposite(side)))).not.toBeDisplayed()
      expect(await events()).toEqual({
        starts: 2,
        ends: 2,
        left: side === 'left' ? 2 : 0,
        right: side === 'right' ? 2 : 0
      })
      await swipeRow(0, side)
      await waitEnd(0, opposite(side), 'open')
      await waitOffset(0, side === 'left' ? -120 : 80)
      await $(selectors.twoSidedAction(0, opposite(side))).click()
    })

    it(`${side}: autoClose reports open once on the triggering side after returning closed`, async () => {
      await option('auto-close', 'Auto close: on')
      await swipeRow(0, directionFor(side))
      await waitEnd(0, side, 'open')
      await waitOffset(0, 0)
      const expected = {
        starts: 1,
        ends: 1,
        left: side === 'left' ? 1 : 0,
        right: side === 'right' ? 1 : 0
      }
      expect(await events()).toEqual(expected)
      await expectQuietClosed(0, expected)
      await expect($(selectors.twoSidedAction(0, side))).not.toBeDisplayed()
      await swipeRow(0, directionFor(opposite(side)))
      await waitEnd(0, opposite(side), 'open')
      await waitOffset(0, 0)
      expect(await events()).toEqual({ starts: 2, ends: 2, left: 1, right: 1 })
      await expect($(selectors.twoSidedPresses(0))).toHaveText(
        'Left 0; right 0; more 0; alternate 0'
      )
    })

    for (const list of ['FlashList', 'FlatList'] as const) {
      it(`${list}: restores ${side} with resized widths through rebind, reorder and attach; closeAll reaches replacements`, async () => {
        if (list === 'FlatList') {
          await selectTab('recycling')
          await tapControl('list-type')
          await expect($(selectors.twoSidedControlLabel('list-type'))).toHaveText('List: FlatList')
          await waitOffset(0, 0)
        }
        await command(`open-${side}`)
        await waitEnd(0, side, 'open')
        await waitOffset(0, side === 'left' ? 80 : -120)
        await option(`${side}-width`, side === 'left' ? 'Left width: 112' : 'Right width: 160')
        const restoredOffset = side === 'left' ? 112 : -160
        await waitOffset(0, restoredOffset)
        // Resizing the other edge must not move the open one.
        await option(
          `${opposite(side)}-width`,
          side === 'left' ? 'Right width: 160' : 'Left width: 112'
        )
        await waitOffset(0, restoredOffset)
        const baseline = await events()
        await selectTab('recycling')
        await tapControl('rebind')
        await $(selectors.twoSidedRow(100)).waitForDisplayed()
        await $(selectors.twoSidedRow(0)).waitForExist({ reverse: true })
        await waitOffset(100, 0)
        expect(await events(100)).toEqual({ starts: 0, ends: 0, left: 0, right: 0 })
        await command(`static-${opposite(side)}`)
        await waitEnd(100, opposite(side), 'open')
        await waitOffset(100, side === 'left' ? -160 : 112)
        await $(selectors.twoSidedAction(100, opposite(side))).click()
        await selectTab('recycling')
        await tapControl('rebind')
        await $(selectors.twoSidedRow(0)).waitForDisplayed()
        await waitOffset(0, restoredOffset)
        await expect($(selectors.twoSidedAction(100, opposite(side)))).not.toExist()
        expect(await events()).toEqual(baseline)
        await $(selectors.twoSidedAction(0, side)).click()
        await expect($(selectors.twoSidedPresses(0))).toHaveText(
          side === 'left'
            ? 'Left 1; right 0; more 0; alternate 0'
            : 'Left 0; right 1; more 0; alternate 0'
        )

        await selectTab('recycling')
        await tapControl('reorder')
        await expect($(selectors.twoSidedControlLabel('reorder'))).toHaveText(
          'Swap first two: 1 first'
        )
        await showReorderedRows()
        await waitOffset(0, restoredOffset)
        expect((await $(selectors.twoSidedFrame(1)).getLocation()).y).toBeLessThan(
          (await $(selectors.twoSidedFrame(0)).getLocation()).y
        )
        await command(`open-${opposite(side)}`)
        await waitEnd(1, opposite(side), 'open')
        await showReorderedRows()
        await waitOffset(1, side === 'left' ? -160 : 112)
        await waitOffset(0, restoredOffset)
        await selectTab('recycling')
        await tapControl('attach')
        await $(selectors.twoSidedList).waitForExist({ reverse: true })
        await tapControl('attach')
        await $(selectors.twoSidedList).waitForDisplayed()
        await showReorderedRows()
        await waitOffset(0, restoredOffset)
        await waitOffset(1, side === 'left' ? -160 : 112)
        await expect($(selectors.twoSidedAction(0, side))).toBeDisplayed()
        await expect($(selectors.twoSidedAction(1, opposite(side)))).toBeDisplayed()
        await command('close-all')
        await showReorderedRows()
        await waitOffset(0, 0)
        await waitOffset(1, 0)
        await expect($(selectors.twoSidedAction(0, side))).not.toBeDisplayed()
        await expect($(selectors.twoSidedAction(1, opposite(side)))).not.toBeDisplayed()
        // Restoring again must not revive a closed cache entry.
        await selectTab('recycling')
        await tapControl('attach')
        await $(selectors.twoSidedList).waitForExist({ reverse: true })
        await tapControl('attach')
        await showReorderedRows()
        await waitOffset(0, 0)
        await waitOffset(1, 0)
      })
    }
  }

  it('caller-owned rounded and inset multiple actions preserve both reveal widths and tappable targets', async () => {
    await option('rounded', 'Rounded / inset: on')
    await option('multiple', 'Multiple actions: on')
    await option('light', 'Row surroundings: light')
    await command('open-left')
    await waitEnd(0, 'left', 'open')
    await waitOffset(0, 80)
    await $(selectors.twoSidedAction(0, 'left')).click()
    await command('open-right')
    await waitEnd(0, 'right', 'open')
    await waitOffset(0, -120)
    const { scale } = await geometry()
    for (const action of ['right', 'more'] as const) {
      const button = await $(selectors.twoSidedAction(0, action))
      await button.waitForDisplayed()
      const size = await button.getSize()
      expect(size.width / scale).toBeGreaterThanOrEqual(44)
      expect(size.height / scale).toBeGreaterThanOrEqual(44)
      await button.click()
    }
    await expect($(selectors.twoSidedPresses(0))).toHaveText('Left 1; right 1; more 1; alternate 0')
    await waitOffset(0, -120)
    await command('close-all')
    await waitOffset(0, 0)
  })
})
