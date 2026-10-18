import assert from 'node:assert/strict'
import { test } from 'node:test'
import gestures from './gestures.ts'

const { scrollUpUntilDisplayed } = gestures
const selector = 'id=row-item-0'

async function withFixture(options, run) {
  const previousDriver = globalThis.driver
  const previousSelector = globalThis.$
  const calls = { gestures: 0, releases: 0, pauses: [], checks: 0 }
  const fail = (stage) => {
    if (options.failAt === stage) throw options.error
  }
  globalThis.$ = (received) => {
    assert.equal(received, selector)
    fail('lookup')
    return {
      async isDisplayed() {
        calls.checks++
        if (calls.checks === (options.failOnCheck ?? 1)) fail('visibility')
        return calls.gestures >= options.visibleAfter
      }
    }
  }
  globalThis.driver = {
    async getWindowSize() {
      fail('window')
      return { width: 1080, height: 2400 }
    },
    async performActions() {
      fail('actions')
      calls.gestures++
    },
    async releaseActions() {
      fail('release')
      calls.releases++
    },
    async pause(duration) {
      fail('pause')
      calls.pauses.push(duration)
    }
  }
  try {
    await run(calls)
  } finally {
    if (previousDriver === undefined) delete globalThis.driver
    else globalThis.driver = previousDriver
    if (previousSelector === undefined) delete globalThis.$
    else globalThis.$ = previousSelector
  }
}

test('bounded scroll navigation without a device or transport', async (t) => {
  await t.test('initially visible target sends zero gestures or waits', async () => {
    await withFixture({ visibleAfter: 0 }, async (calls) => {
      await scrollUpUntilDisplayed(selector, 10)
      assert.deepEqual(calls, { gestures: 0, releases: 0, pauses: [], checks: 1 })
    })
  })

  await t.test('target appearing before the cap stops immediately', async () => {
    await withFixture({ visibleAfter: 3 }, async (calls) => {
      await scrollUpUntilDisplayed(selector, 10)
      assert.deepEqual(calls, { gestures: 3, releases: 3, pauses: [300, 300, 300], checks: 4 })
    })
  })

  await t.test(
    'target appearing on exactly the tenth gesture succeeds without extra waits',
    async () => {
      await withFixture({ visibleAfter: 10 }, async (calls) => {
        await scrollUpUntilDisplayed(selector, 10)
        assert.deepEqual(calls, {
          gestures: 10,
          releases: 10,
          pauses: Array(10).fill(300),
          checks: 11
        })
      })
    }
  )

  await t.test('target absent after ten gestures fails without an eleventh gesture', async () => {
    await withFixture({ visibleAfter: Infinity }, async (calls) => {
      await assert.rejects(
        scrollUpUntilDisplayed(selector, 10),
        new Error(`Element "${selector}" not visible after 10 scroll attempts`)
      )
      assert.deepEqual(calls, {
        gestures: 10,
        releases: 10,
        pauses: Array(10).fill(300),
        checks: 11
      })
    })
  })

  for (const failAt of ['lookup', 'visibility', 'window', 'actions', 'release', 'pause']) {
    await t.test(`original ${failAt} error propagates without retry`, async () => {
      const error = new Error(`original ${failAt} failure`)
      await withFixture({ visibleAfter: Infinity, failAt, error }, async (calls) => {
        await assert.rejects(scrollUpUntilDisplayed(selector, 10), (received) => received === error)
        assert.equal(calls.gestures, ['release', 'pause'].includes(failAt) ? 1 : 0)
        assert.equal(calls.pauses.length, 0)
      })
    })
  }

  await t.test(
    'final visibility-check error propagates instead of becoming exhaustion',
    async () => {
      const error = new Error('original final visibility failure')
      await withFixture(
        { visibleAfter: Infinity, failAt: 'visibility', failOnCheck: 11, error },
        async (calls) => {
          await assert.rejects(
            scrollUpUntilDisplayed(selector, 10),
            (received) => received === error
          )
          assert.deepEqual(calls, {
            gestures: 10,
            releases: 10,
            pauses: Array(10).fill(300),
            checks: 11
          })
        }
      )
    }
  )
})
