import assert from 'node:assert/strict'
import { test } from 'node:test'
import readiness from './touch-readiness.ts'

const { relaunchApp, waitForTouchReadiness } = readiness
const fast = { timeout: 400, moveWindow: 40, interval: 5 }
const REST = 172
const THUMB = 28

// A seekbar like the demo's: the pan area moves the thumb by the drag translation,
// clamped to [0, REST]. `lost` drags never reach the app, like drags sent in a stall.
async function withFixture(options, run) {
  const previousDriver = globalThis.driver
  const previousSelector = globalThis.$
  const track = options.track ?? { x: 86, y: 300, width: 200, height: 48 }
  const thumbBase = options.thumbBase ?? track.x
  const state = {
    thumbX: REST,
    drags: [],
    calls: [],
    displayed: options.displayed ?? (() => true),
    lost: options.lost ?? (() => false)
  }
  const thumbRect = () => ({
    x: thumbBase + state.thumbX,
    y: track.y + track.height / 2 - THUMB / 2,
    width: THUMB,
    height: THUMB
  })
  globalThis.$ = (selector) => ({
    elementId: selector,
    async isDisplayed() {
      assert.equal(selector, 'id=seekbar-track')
      return state.displayed(state)
    }
  })
  globalThis.driver = {
    isIOS: options.isIOS ?? true,
    async getElementRect(id) {
      if (id === 'id=seekbar-track') return { ...track }
      assert.equal(id, 'id=seekbar-thumb')
      return thumbRect()
    },
    async getWindowSize() {
      return { width: 390, height: 844 }
    },
    async performActions(actions) {
      const [{ actions: steps }] = actions
      assert.deepEqual(
        steps.map(({ type, duration }) => [type, duration]),
        [
          ['pointerMove', 0],
          ['pointerDown', undefined],
          ['pause', 100],
          ['pointerMove', 300],
          ['pointerUp', undefined]
        ]
      )
      const from = { x: steps[0].x, y: steps[0].y }
      const to = { x: steps[3].x, y: steps[3].y }
      state.drags.push({ from, to })
      if (state.lost(state.drags.length, state)) return
      const inside =
        from.x >= track.x &&
        from.x <= track.x + track.width &&
        from.y >= track.y &&
        from.y <= track.y + track.height
      if (inside) state.thumbX = Math.max(0, Math.min(REST, state.thumbX + to.x - from.x))
    },
    async releaseActions() {
      state.calls.push('releaseActions')
    },
    async terminateApp(id) {
      state.calls.push(`terminateApp ${id}`)
    },
    async activateApp(id) {
      state.calls.push(`activateApp ${id}`)
    },
    async waitUntil(condition, { timeout, interval }) {
      const end = Date.now() + timeout
      for (;;) {
        if (await condition()) return true
        if (Date.now() >= end) throw new Error('waitUntil timeout')
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }
  }
  try {
    await run(state, thumbRect)
  } finally {
    if (previousDriver === undefined) delete globalThis.driver
    else globalThis.driver = previousDriver
    if (previousSelector === undefined) delete globalThis.$
    else globalThis.$ = previousSelector
  }
}

test('touch readiness gate without a device or transport', async (t) => {
  await t.test('a drag that lands moves the thumb, then the thumb returns to rest', async () => {
    await withFixture({}, async (state) => {
      const result = await waitForTouchReadiness(fast)
      assert.equal(result.drags, 2)
      assert.deepEqual(state.drags, [
        { from: { x: 272, y: 324 }, to: { x: 232, y: 324 } },
        { from: { x: 232, y: 324 }, to: { x: 312, y: 324 } }
      ])
      assert.equal(state.thumbX, REST)
      assert.equal(state.calls.filter((call) => call === 'releaseActions').length, 2)
    })
  })

  await t.test('lost drags are sent again while the list screen stays', async () => {
    await withFixture({ lost: (n) => n <= 2 }, async (state) => {
      const result = await waitForTouchReadiness(fast)
      assert.equal(result.drags, 4)
      assert.deepEqual(
        state.drags.map(({ from, to }) => to.x - from.x),
        [-40, -40, -40, 80]
      )
      assert.equal(state.thumbX, REST)
    })
  })

  await t.test('a lost restore drag is sent again until the thumb is at rest', async () => {
    await withFixture({ lost: (n) => n === 2 }, async (state) => {
      const result = await waitForTouchReadiness(fast)
      assert.equal(result.drags, 3)
      assert.equal(state.thumbX, REST)
    })
  })

  await t.test('touches that never land fail within the overall timeout', async () => {
    await withFixture({ lost: () => true }, async (state) => {
      const started = Date.now()
      await assert.rejects(
        waitForTouchReadiness(fast),
        /Touch readiness gate failed after \d+ drag\(s\) in \d+ ms: .*touches do not reach the app/
      )
      assert.ok(Date.now() - started < fast.timeout + 200)
      assert.ok(state.drags.length > 1)
      assert.equal(state.thumbX, REST)
    })
  })

  await t.test('no drag is sent again once the app leaves the list screen', async () => {
    const displayed = (state) => state.drags.length === 0
    await withFixture({ lost: () => true, displayed }, async (state) => {
      await assert.rejects(waitForTouchReadiness(fast), /the app left the list screen/)
      assert.equal(state.drags.length, 1)
    })
  })

  await t.test('no drag is sent when the list screen never appears', async () => {
    await withFixture({ displayed: () => false }, async (state) => {
      await assert.rejects(
        waitForTouchReadiness(fast),
        /after 0 drag\(s\) in \d+ ms: the list screen seekbar did not appear/
      )
      assert.equal(state.drags.length, 0)
    })
  })

  await t.test('a thumb outside its pan area is dragged through the pan area', async () => {
    // RTL: the thumb starts at the far track end and the rest offset pushes it past.
    const track = { x: 104, y: 300, width: 200, height: 48 }
    await withFixture({ track, thumbBase: track.x + 172 }, async (state) => {
      await waitForTouchReadiness(fast)
      assert.deepEqual(state.drags[0], { from: { x: 204, y: 324 }, to: { x: 164, y: 324 } })
      assert.equal(state.thumbX, REST)
    })
  })

  await t.test('relaunch on iOS passes the gate', async () => {
    await withFixture({}, async (state) => {
      await relaunchApp('com.swipeabledemo.app')
      assert.deepEqual(state.calls.slice(0, 2), [
        'terminateApp com.swipeabledemo.app',
        'activateApp com.swipeabledemo.app'
      ])
      assert.equal(state.drags.length, 2)
    })
  })

  await t.test('relaunch on Android sends no probe', async () => {
    await withFixture({ isIOS: false }, async (state) => {
      await relaunchApp('com.swipeabledemo.app')
      assert.deepEqual(state.calls, [
        'terminateApp com.swipeabledemo.app',
        'activateApp com.swipeabledemo.app'
      ])
      assert.equal(state.drags.length, 0)
    })
  })
})
