import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import geometryModule from './fast-geometry.ts'
const { parseGeometry, createFastGeometryReader, createExpandedReader } = geometryModule

// Offline only. No session creation, sockets, devices, or fixture imports.
const require = createRequire(import.meta.url)
const key = 'element-6066-11e4-a52e-4f735466cecf'
const original = {
  shouldUseCompactResponses: true,
  elementResponseAttributes: 'type,label,attribute/name'
}
const expanded = {
  shouldUseCompactResponses: false,
  elementResponseAttributes: 'rect,text,attribute/name'
}
const names = (id) => ['frame', 'anchor', 'layout'].map((part) => `two-sided-${part}-${id}`)
const predicate = (id) =>
  names(id)
    .map((name) => `name == ${JSON.stringify(name)}`)
    .join(' OR ')
const clone = (value) => structuredClone(value)
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function payload({ id = 0, scale = 1, offset = 0, generation = 'initial', rawText } = {}) {
  const width = 378 * scale
  const x = 12
  const y = id === 100 ? 436 : 436 + id * 101
  const frame = { x, y, width, height: 101 }
  const anchor = { x: x + width / 2 + offset - 1, y: y + 80, width: 2, height: 2 }
  return names(id).map((name, i) => ({
    [key]: `${generation}-row-${id}-${i}`,
    ELEMENT: `${generation}-row-${id}-${i}`,
    'attribute/name': name,
    rect: i === 1 ? anchor : { ...frame },
    text: i === 2 ? (rawText ?? `Row width 378; key two-sided-demo-${id}`) : null
  }))
}
const stepNames = ['capture', 'expand', 'confirm', 'query', 'restore', 'restore-confirm']
function fake({ initial = original, fault, response = () => payload() } = {}) {
  const calls = []
  let current = clone(initial)
  const retiredError = new Error('original owner retired')
  let retired = false
  async function invoke(method, argument, operation) {
    const call = { method, ...(argument === undefined ? {} : { argument: clone(argument) }) }
    calls.push(call)
    const info = { number: calls.length, method, argument, current: clone(current) }
    if (fault) {
      const replacement = await fault(info)
      if (replacement?.override) return replacement.value
    }
    return operation()
  }
  const driver = {
    getSettings: () => invoke('getSettings', undefined, () => clone(current)),
    updateSettings: (value) =>
      invoke('updateSettings', value, () => {
        current = { ...current, ...value }
        return null
      }),
    findElements: (using, value) => invoke('findElements', { using, value }, () => response(calls))
  }
  const assertOwnerActive = () => {
    if (retired) throw retiredError
  }
  return {
    calls,
    driver,
    read: createFastGeometryReader(driver, { assertOwnerActive }),
    retire() {
      retired = true
    },
    retiredError,
    get settings() {
      return clone(current)
    }
  }
}
function expectedCalls(id, initial = original) {
  return [
    { method: 'getSettings' },
    { method: 'updateSettings', argument: expanded },
    { method: 'getSettings' },
    { method: 'findElements', argument: { using: '-ios predicate string', value: predicate(id) } },
    { method: 'updateSettings', argument: initial },
    { method: 'getSettings' }
  ]
}
// A restoration confirmed the baseline, so the next read on the session skips the capture.
const cachedCalls = (id, initial = original) => expectedCalls(id, initial).slice(1)

for (const id of [0, 1, 100]) {
  for (const scale of [1, 2, 3]) {
    for (const layoutOffset of [-80, 0, 80]) {
      test(`parse row${id}, scale ${scale}, layout offset ${layoutOffset}`, () => {
        const rows = payload({ id, scale, offset: layoutOffset * scale })
        const geometry = parseGeometry([rows[2], rows[0], rows[1]], id)
        assert.deepEqual(geometry, {
          frame: rows[0].rect,
          anchor: rows[1].rect,
          rawText: `Row width 378; key two-sided-demo-${id}`,
          text: `Row width 378; key two-sided-demo-${id}`,
          layoutWidth: 378,
          scale,
          offset: layoutOffset * scale,
          layoutOffset
        })
      })
    }
  }
}
test('raw whitespace preserved exactly while normalized binding validates', () => {
  const rawText = ' \tRow\n width 378;\r\n  key\t two-sided-demo-100  \n'
  const result = parseGeometry(payload({ id: 100, rawText }), 100)
  assert.equal(result.rawText, rawText)
  assert.equal(result.text, 'Row width 378; key two-sided-demo-100')
})
test('fresh references accepted after reattach and replacement', () => {
  const before = payload()
  const reattached = payload({ generation: 'reattached', offset: 80 })
  const replacement = payload({ id: 100, generation: 'replacement', offset: -80 })
  assert.notEqual(before[0][key], reattached[0][key])
  assert.notEqual(reattached[0][key], replacement[0][key])
  assert.equal(parseGeometry(before, 0).offset, 0)
  assert.equal(parseGeometry(reattached, 0).offset, 80)
  assert.equal(parseGeometry(replacement, 100).offset, -80)
})
for (const mode of ['w3c', 'legacy', 'matching-dual']) {
  test(`accept ${mode} references`, () => {
    const rows = payload()
    for (const entry of rows) {
      if (mode === 'w3c') delete entry.ELEMENT
      if (mode === 'legacy') delete entry[key]
    }
    assert.equal(parseGeometry(rows, 0).layoutWidth, 378)
  })
}
const invalid = [
  ['non-array', () => ({ value: payload() }), /exactly three/],
  ['missing match', (p) => p.slice(1), /exactly three/],
  ['extra match', (p) => [...p, p[0]], /exactly three/],
  [
    'null entry',
    (p) => {
      p[0] = null
    },
    /object/
  ],
  [
    'array entry',
    (p) => {
      p[0] = []
    },
    /object/
  ],
  [
    'duplicate name',
    (p) => {
      p[1]['attribute/name'] = p[0]['attribute/name']
    },
    /name/
  ],
  [
    'missing name',
    (p) => {
      delete p[0]['attribute/name']
    },
    /name/
  ],
  [
    'type substituted for name',
    (p) => {
      delete p[0]['attribute/name']
      p[0].name = 'XCUIElementTypeOther'
      p[0].type = 'XCUIElementTypeOther'
    },
    /name/
  ],
  [
    'wrong row name',
    (p) => {
      p[0]['attribute/name'] = 'two-sided-frame-1'
    },
    /name/
  ],
  [
    'numeric name',
    (p) => {
      p[0]['attribute/name'] = 0
    },
    /name/
  ],
  [
    'missing references',
    (p) => {
      delete p[0][key]
      delete p[0].ELEMENT
    },
    /reference/
  ],
  [
    'empty reference',
    (p) => {
      p[0][key] = ''
      p[0].ELEMENT = ''
    },
    /reference/
  ],
  [
    'numeric reference',
    (p) => {
      p[0][key] = 42
      p[0].ELEMENT = 42
    },
    /reference/
  ],
  [
    'duplicate references',
    (p) => {
      p[1][key] = p[0][key]
      p[1].ELEMENT = p[0].ELEMENT
    },
    /reference/
  ],
  [
    'conflicting references',
    (p) => {
      p[0].ELEMENT = 'conflict'
    },
    /Conflicting/
  ],
  [
    'missing rect',
    (p) => {
      delete p[0].rect
    },
    /object/
  ],
  [
    'null rect',
    (p) => {
      p[0].rect = null
    },
    /object/
  ],
  [
    'array rect',
    (p) => {
      p[0].rect = []
    },
    /object/
  ],
  [
    'negative width',
    (p) => {
      p[0].rect.width = -1
    },
    /Negative/
  ],
  [
    'negative height',
    (p) => {
      p[1].rect.height = -1
    },
    /Negative/
  ],
  [
    'zero frame width',
    (p) => {
      p[0].rect.width = 0
    },
    /layout width/
  ],
  [
    'missing frame text',
    (p) => {
      delete p[0].text
    },
    /text/
  ],
  [
    'numeric anchor text',
    (p) => {
      p[1].text = 1
    },
    /text/
  ],
  [
    'missing layout text',
    (p) => {
      delete p[2].text
    },
    /text/
  ],
  [
    'object layout text',
    (p) => {
      p[2].text = {}
    },
    /text/
  ],
  [
    'null layout text',
    (p) => {
      p[2].text = null
    },
    /layout width/
  ],
  [
    'zero layout width',
    (p) => {
      p[2].text = 'Row width 0; key two-sided-demo-0'
    },
    /layout width/
  ],
  [
    'negative layout width',
    (p) => {
      p[2].text = 'Row width -1; key two-sided-demo-0'
    },
    /layout width/
  ],
  [
    'fractional layout width',
    (p) => {
      p[2].text = 'Row width 378.5; key two-sided-demo-0'
    },
    /layout width/
  ],
  [
    'infinite layout width',
    (p) => {
      p[2].text = `Row width ${'9'.repeat(400)}; key two-sided-demo-0`
    },
    /layout width/
  ],
  [
    'missing binding text',
    (p) => {
      p[2].text = 'Row width 378'
    },
    /layout width/
  ],
  [
    'stale binding',
    (p) => {
      p[2].text = 'Row width 378; key two-sided-demo-1'
    },
    /Stale geometry binding/
  ],
  [
    'stale recycled row100 binding',
    (p) => {
      p[2].text = 'Row width 378; key two-sided-demo-100'
    },
    /Stale geometry binding/
  ],
  [
    'noncanonical binding',
    (p) => {
      p[2].text = 'Row width 378; key two-sided-demo-00'
    },
    /Stale geometry binding/
  ],
  [
    'trailing text',
    (p) => {
      p[2].text += ' extra'
    },
    /layout width/
  ]
]
for (const field of ['x', 'y', 'width', 'height']) {
  for (const value of [undefined, '1', NaN, Infinity, -Infinity, 1.5]) {
    invalid.push([
      `rect.${field} rejects ${String(value)} (${typeof value})`,
      (p) => {
        p[1].rect[field] = value
      },
      /Invalid native rect/
    ])
  }
}
for (const [label, mutate, message] of invalid) {
  test(`validation: ${label}`, () => {
    const rows = payload()
    const replacement = mutate(rows)
    assert.throws(() => parseGeometry(replacement ?? rows, 0), message)
  })
}
for (const id of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
  test(`invalid row ID ${String(id)} (${typeof id}) fails before driver calls`, async () => {
    assert.throws(() => parseGeometry(payload(), id), /Invalid row ID/)
    const f = fake()
    await assert.rejects(f.read(id), /Invalid row ID/)
    assert.deepEqual(f.calls, [])
  })
}
for (const initial of [
  original,
  { shouldUseCompactResponses: false, elementResponseAttributes: ' text,rect,attribute/name ' },
  { shouldUseCompactResponses: true, elementResponseAttributes: '' }
]) {
  test(`six-request healthy transaction exactly restores ${JSON.stringify(initial)}`, async () => {
    const f = fake({ initial, response: () => payload({ id: 100 }) })
    assert.equal((await f.read(100)).layoutOffset, 0)
    assert.deepEqual(f.calls, expectedCalls(100, initial))
    assert.deepEqual(f.settings, initial)
  })
}
test('an already expanded baseline sends no settings update', async () => {
  const f = fake({ initial: expanded, response: () => payload({ id: 100 }) })
  assert.equal((await f.read(100)).layoutOffset, 0)
  assert.deepEqual(f.calls, [expectedCalls(100)[0], expectedCalls(100)[3]])
  assert.deepEqual(f.settings, expanded)
})
test('fresh query every read, including reattach, replacement, changed text and settings baseline', async () => {
  let generation = 0
  const ids = [0, 0, 100]
  const offsets = [0, 80, -80]
  const f = fake({
    response: () => {
      const i = generation++
      return payload({
        id: ids[i],
        offset: offsets[i],
        generation: `generation-${i}`,
        rawText: ` Row width 378;  key two-sided-demo-${ids[i]}\n`
      })
    }
  })
  const a = await f.read(0)
  a.frame.x = 999
  const b = await f.read(0)
  const c = await f.read(100)
  assert.equal(b.frame.x, 12)
  assert.deepEqual([a.offset, b.offset, c.offset], offsets)
  assert.equal(generation, 3)
  assert.deepEqual(f.calls, [
    ...expectedCalls(ids[0]),
    ...cachedCalls(ids[1]),
    ...cachedCalls(ids[2])
  ])
  assert.equal(c.rawText, ' Row width 378;  key two-sided-demo-100\n')
  const newBaseline = { shouldUseCompactResponses: false, elementResponseAttributes: 'label' }
  await f.driver.updateSettings(newBaseline)
  // A separate reader sees the actual driver settings, not a module-level cache.
  const second = createFastGeometryReader(
    { ...f.driver, findElements: async () => payload() },
    { assertOwnerActive() {} }
  )
  await second()
  assert.deepEqual(f.settings, newBaseline)
})
for (const [index, label] of stepNames.entries()) {
  test(`${label} transport failure retains exact error identity`, async () => {
    const failure = new Error(`${label} failed`)
    const f = fake({
      fault: ({ number }) => {
        if (number === index + 1) throw failure
      }
    })
    await assert.rejects(f.read(), (error) => error === failure)
    const expected =
      index === 0
        ? ['getSettings']
        : index === 1
          ? ['getSettings', 'updateSettings', 'updateSettings', 'getSettings']
          : index === 2
            ? ['getSettings', 'updateSettings', 'getSettings', 'updateSettings', 'getSettings']
            : index === 3
              ? expectedCalls(0).map((call) => call.method)
              : expectedCalls(0)
                  .slice(0, index + 1)
                  .map((call) => call.method)
    assert.deepEqual(
      f.calls.map((call) => call.method),
      expected
    )
    if (index > 0 && index < 4) assert.deepEqual(f.settings, original)
  })
}
for (const badSettings of [
  null,
  [],
  {},
  { shouldUseCompactResponses: 'true', elementResponseAttributes: 'rect' },
  { shouldUseCompactResponses: true }
]) {
  test(`capture malformed settings ${JSON.stringify(badSettings)} never mutates`, async () => {
    const f = fake({
      fault: ({ number }) => (number === 1 ? { override: true, value: badSettings } : undefined)
    })
    await assert.rejects(f.read())
    assert.deepEqual(f.calls, [{ method: 'getSettings' }])
  })
}
for (const phase of ['confirm', 'restore-confirm']) {
  test(`${phase} mismatch is rejected`, async () => {
    const numberToFail = phase === 'confirm' ? 3 : 6
    const f = fake({
      fault: ({ number }) =>
        number === numberToFail
          ? { override: true, value: phase === 'confirm' ? original : expanded }
          : undefined
    })
    await assert.rejects(f.read(), /settings were not confirmed/)
    assert.equal(f.calls.length, phase === 'confirm' ? 5 : 6)
    assert.deepEqual(f.settings, original)
  })
}
test('invalid query payload restores original settings before rejecting', async () => {
  const f = fake({ response: () => payload().slice(1) })
  await assert.rejects(f.read(), /exactly three/)
  assert.deepEqual(f.calls, expectedCalls(0))
  assert.deepEqual(f.settings, original)
})
for (const failure of [
  new Error('original query error'),
  undefined,
  null,
  0,
  'original thrown string'
]) {
  test(`query failure identity survives restoration failure: ${String(failure)}`, async () => {
    const restoreFailure = new Error('secondary restoration error')
    const f = fake({
      fault: ({ number }) => {
        if (number === 4) throw failure
        if (number === 5) throw restoreFailure
      }
    })
    const outcome = await f.read().then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
    assert.equal(outcome.ok, false)
    assert.strictEqual(outcome.error, failure)
    assert.equal(f.calls.length, 5)
  })
}
test('concurrent read excluded before requests; completed transaction releases lock', async () => {
  const started = deferred()
  const release = deferred()
  const f = fake({
    fault: async ({ number }) => {
      if (number === 1) {
        started.resolve()
        await release.promise
      }
    }
  })
  const first = f.read()
  await started.promise
  await assert.rejects(f.read(1), /Concurrent geometry read/)
  assert.equal(f.calls.length, 1)
  release.resolve()
  await first
  await f.read()
  assert.deepEqual(f.calls, [...expectedCalls(0), ...cachedCalls(0)])
})
test('failed query with confirmed restoration releases lock and uses a fresh query', async () => {
  const failure = new Error('query failed once')
  const f = fake({
    fault: ({ number }) => {
      if (number === 4) throw failure
    }
  })
  await assert.rejects(f.read(), (error) => error === failure)
  await f.read()
  assert.deepEqual(f.calls, [...expectedCalls(0), ...cachedCalls(0)])
})
test('a new session captures its own baseline again', async () => {
  const f = fake()
  f.driver.sessionId = 'first'
  await f.read()
  await f.read()
  f.driver.sessionId = 'second'
  await f.read()
  await f.read()
  assert.deepEqual(f.calls, [
    ...expectedCalls(0),
    ...cachedCalls(0),
    ...expectedCalls(0),
    ...cachedCalls(0)
  ])
  assert.deepEqual(f.settings, original)
})
for (const [label, fault] of [
  ['malformed capture', ({ number }) => (number === 1 ? { override: true, value: {} } : undefined)],
  [
    'failed restoration confirmation',
    ({ number }) => {
      if (number === 6) throw new Error('restore confirmation failed')
    }
  ]
]) {
  test(`${label} never seeds a reusable baseline`, async () => {
    const f = fake({ fault })
    await assert.rejects(f.read())
    const count = f.calls.length
    if (label === 'malformed capture') {
      await f.read()
      assert.deepEqual(f.calls.slice(count), expectedCalls(0))
    } else {
      await assert.rejects(f.read(), /disabled after unconfirmed settings restoration/)
      assert.equal(f.calls.length, count)
    }
  })
}
test('readers with other attributes share one confirmed baseline per driver', async () => {
  const f = fake()
  const controls = { shouldUseCompactResponses: false, elementResponseAttributes: 'rect' }
  const observe = createExpandedReader(f.driver, {
    assertOwnerActive() {},
    attributes: controls.elementResponseAttributes
  })
  await observe('controls', (response) => response)
  await f.read()
  assert.deepEqual(f.calls, [
    { method: 'getSettings' },
    { method: 'updateSettings', argument: controls },
    { method: 'getSettings' },
    { method: 'findElements', argument: { using: '-ios predicate string', value: 'controls' } },
    { method: 'updateSettings', argument: original },
    { method: 'getSettings' },
    ...cachedCalls(0)
  ])
  assert.deepEqual(f.settings, original)
})
test('retired late query result rejected with no restoration or subsequent driver calls', async () => {
  const started = deferred()
  const release = deferred()
  const f = fake({
    response: () => {
      started.resolve()
      return release.promise
    }
  })
  const running = f.read()
  const outcome = running.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  )
  await started.promise
  f.retire()
  release.resolve(payload())
  const settled = await outcome
  assert.equal(settled.ok, false)
  assert.strictEqual(settled.error, f.retiredError)
  assert.equal(f.calls.length, 4)
  assert.deepEqual(f.settings, expanded)
  await assert.rejects(f.read(), (error) => error === f.retiredError)
  assert.equal(f.calls.length, 4)
})
for (const mode of ['update failure', 'confirmation failure', 'confirmation mismatch']) {
  test(`SAFETY: failed restoration (${mode}) permanently excludes further driver requests`, async () => {
    const failure = new Error(`restore ${mode}`)
    const f = fake({
      fault: ({ number }) => {
        if (mode === 'update failure' && number === 5) throw failure
        if (mode === 'confirmation failure' && number === 6) throw failure
        if (mode === 'confirmation mismatch' && number === 6)
          return { override: true, value: expanded }
      }
    })
    await assert.rejects(
      f.read(),
      mode === 'confirmation mismatch'
        ? /settings were not confirmed/
        : (error) => error === failure
    )
    const count = f.calls.length
    const later = await f.read().then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
    assert.equal(
      f.calls.length,
      count,
      `Failed restoration must retire this reader; later call issued ${f.calls.length - count} forbidden driver requests (later resolved=${later.ok})`
    )
    assert.equal(
      later.ok,
      false,
      'A reader with unconfirmed restoration must reject subsequent calls'
    )
  })
}

// Adapted from the known expanded-response fixture without importing/executing it.
// Real installed WebDriver + real command guard + owned Mocha runnables.
async function guardedFixture(holdQuery, body) {
  const Mocha = require('mocha')
  const { MockAgent, Dispatcher, getGlobalDispatcher, setGlobalDispatcher } = require('undici')
  const { default: WebDriver } = await import('webdriver')
  const imported = await import('./command-scope.ts')
  const guard = (imported.default ?? imported).createCommandGuard()
  const mock = new MockAgent()
  mock.disableNetConnect()
  const origin = 'http://fast-geometry-offline.invalid'
  const prefix = '/session/fast-geometry-offline'
  const requests = []
  const violations = []
  const trace = []
  const accepted = deferred()
  const lateResponse = deferred()
  const completed = deferred()
  const raw = payload({
    id: 100,
    generation: 'real-wire',
    scale: 2,
    offset: -160,
    rawText: ' \tRow width 378;\n key two-sided-demo-100  '
  })
  let settings = clone(original)
  let queryFailure
  const plan = [
    { method: 'GET', path: `${prefix}/appium/settings` },
    { method: 'POST', path: `${prefix}/appium/settings`, payload: { settings: expanded } },
    { method: 'GET', path: `${prefix}/appium/settings` },
    {
      method: 'POST',
      path: `${prefix}/elements`,
      payload: { using: '-ios predicate string', value: predicate(100) }
    },
    ...(!holdQuery
      ? [
          { method: 'POST', path: `${prefix}/appium/settings`, payload: { settings: original } },
          { method: 'GET', path: `${prefix}/appium/settings` }
        ]
      : [])
  ]
  const pool = mock.get(origin)
  for (const step of plan) {
    const interceptor = {
      method: step.method,
      path: step.path,
      ...(step.payload === undefined ? {} : { body: JSON.stringify(step.payload) })
    }
    pool.intercept(interceptor).reply(
      200,
      () => {
        if (step.path.endsWith('/elements')) {
          trace.push('expanded-accepted')
          accepted.resolve()
          return holdQuery ? lateResponse.promise : { value: raw }
        }
        if (step.method === 'POST') {
          settings = clone(step.payload.settings)
          return { value: null }
        }
        return { value: clone(settings) }
      },
      { headers: { 'content-type': 'application/json' } }
    )
  }
  class OfflineOnlyDispatcher extends Dispatcher {
    dispatch(options, handler) {
      ;(async () => {
        const chunks = []
        if (typeof options.body === 'string' || Buffer.isBuffer(options.body))
          chunks.push(Buffer.from(options.body))
        else if (options.body != null)
          for await (const chunk of options.body) chunks.push(Buffer.from(chunk))
        const requestBody =
          options.body == null ? undefined : Buffer.concat(chunks).toString('utf8')
        const decoded = requestBody === undefined ? undefined : JSON.parse(requestBody)
        assert.equal(new URL(String(options.origin)).origin, origin)
        const actual = {
          method: options.method,
          path: options.path,
          ...(decoded === undefined ? {} : { payload: decoded })
        }
        const expected = plan[requests.length]
        requests.push(actual)
        assert.deepEqual(actual, expected, 'exact request order/method/path/decoded payload')
        const isQuery = options.path === `${prefix}/elements`
        const observedHandler = new Proxy(handler, {
          get(target, event) {
            if (event === 'onComplete' && isQuery)
              return (...args) => {
                try {
                  return target.onComplete?.(...args)
                } finally {
                  trace.push('expanded-complete')
                  completed.resolve()
                }
              }
            const value = Reflect.get(target, event, target)
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
        // WDIO skips a global dispatcher named MockAgent; this custom dispatcher
        // delegates exclusively to the disabled-network agent after exact checks.
        mock.dispatch({ ...options, origin, body: requestBody }, observedHandler)
      })().catch((error) => {
        violations.push(error)
        handler.onError(error)
      })
      return true
    }
  }
  const previous = getGlobalDispatcher()
  setGlobalDispatcher(new OfflineOnlyDispatcher())
  const driver = WebDriver.attachToSession({
    sessionId: 'fast-geometry-offline',
    protocol: 'http',
    hostname: 'fast-geometry-offline.invalid',
    port: 80,
    path: '/',
    logLevel: 'silent',
    connectionRetryCount: 0,
    connectionRetryTimeout: 2000,
    transformRequest: guard.guardRequest,
    capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' }
  })
  const protocol = {
    getSettings: (...args) => driver.getSettings(...args),
    updateSettings: (...args) => driver.updateSettings(...args),
    async findElements(...args) {
      try {
        const actual = await driver.findElements(...args)
        assert.deepEqual(actual, raw, 'raw WebDriver must retain expanded fields and whitespace')
        return actual
      } catch (error) {
        queryFailure = error
        throw error
      }
    }
  }
  const mocha = new Mocha({
    timeout: 4000,
    reporter: class SilentReporter {},
    rootHooks: guard.mochaHooks
  })
  const failures = []
  try {
    await body({
      guard,
      driver,
      protocol,
      mocha,
      Mocha,
      requests,
      trace,
      accepted: accepted.promise,
      release() {
        lateResponse.resolve({ value: raw })
      },
      completed: completed.promise,
      raw,
      plan,
      failures,
      getSettings: () => clone(settings),
      getQueryFailure: () => queryFailure,
      run: () =>
        new Promise((resolve) =>
          mocha
            .run(resolve)
            .on('fail', (runnable, error) => failures.push({ title: runnable.title, error }))
        )
    })
    assert.deepEqual(violations, [], 'no unmatched or malformed offline dispatch')
    mock.assertNoPendingInterceptors()
  } finally {
    lateResponse.resolve({ value: raw })
    setGlobalDispatcher(previous)
    await mock.close()
  }
}

test('REAL WebDriver + owned Mocha guard: healthy six-request transaction', {
  timeout: 10000
}, async () => {
  await guardedFixture(false, async (f) => {
    f.mocha.suite.addTest(
      new f.Mocha.Test('healthy geometry owner', async () => {
        const signal = f.guard.guardRequest({}).signal
        assert.ok(signal instanceof AbortSignal, 'must have a real Mocha owner')
        const read = createFastGeometryReader(f.protocol, {
          assertOwnerActive: () => f.guard.guardRequest({})
        })
        const result = await read(100)
        assert.deepEqual(result, parseGeometry(f.raw, 100))
        assert.equal(result.layoutOffset, -80)
        assert.equal(result.rawText, ' \tRow width 378;\n key two-sided-demo-100  ')
        assert.equal(signal.aborted, false)
        f.guard.guardRequest({})
        assert.deepEqual(f.getSettings(), original)
        assert.deepEqual(f.requests, f.plan)
        assert.equal(f.requests.length, 6)
        assert.deepEqual(f.trace, ['expanded-accepted', 'expanded-complete'])
      })
    )
    assert.equal(await f.run(), 0, f.failures.map((x) => x.error.stack).join('\n'))
  })
})
test('REAL WebDriver + owned Mocha guard: synchronous retirement quarantines before abort; late completion cannot resurrect', {
  timeout: 10000
}, async () => {
  await guardedFixture(true, async (f) => {
    let nextRan = false
    let abortQuarantine
    let outcome
    let read
    let settled = 0
    let ownerAssertionsCompleted = false
    f.mocha.suite.addTest(
      new f.Mocha.Test('retire accepted geometry query', async () => {
        const signal = f.guard.guardRequest({}).signal
        assert.ok(signal instanceof AbortSignal, 'must have a real Mocha owner')
        signal.addEventListener(
          'abort',
          () => {
            f.trace.push('owner-aborted')
            try {
              f.guard.guardRequest({})
            } catch (error) {
              abortQuarantine = error
            }
          },
          { once: true }
        )
        read = createFastGeometryReader(f.protocol, {
          assertOwnerActive: () => f.guard.guardRequest({})
        })
        const running = read(100).then(
          (value) => {
            settled++
            return { ok: true, value }
          },
          (error) => {
            settled++
            return { ok: false, error }
          }
        )
        await f.accepted
        assert.equal(f.requests.length, 4)
        assert.equal(settled, 0, 'accepted expanded query must still be pending')
        const retire = f.guard.finishCommandScope(() => {
          f.trace.push('retire-callback')
        })
        const retiring = retire()
        // Assert before awaiting retirement: close/quarantine/abort are synchronous.
        assert.equal(signal.aborted, true)
        assert.match(abortQuarantine?.message ?? '', /quarantined/)
        assert.deepEqual(f.trace, ['expanded-accepted', 'owner-aborted', 'retire-callback'])
        await retiring
        await assert.rejects(f.driver.getSettings(), /quarantined/)
        await assert.rejects(read(100), /quarantined/)
        assert.equal(f.requests.length, 4, 'no cleanup or subsequent request reaches dispatcher')
        f.release()
        await f.completed // Actual MockAgent onComplete reaches the guard after retirement.
        outcome = await running
        assert.equal(outcome.ok, false)
        assert.strictEqual(
          outcome.error,
          f.getQueryFailure(),
          'original raw query rejection retained'
        )
        assert.equal(settled, 1)
        assert.deepEqual(f.getSettings(), expanded, 'retirement must not authorize cleanup')
        assert.equal(f.requests.length, 4)
        assert.throws(() => f.guard.guardRequest({}), /quarantined/)
        ownerAssertionsCompleted = true
      })
    )
    f.mocha.suite.addTest(
      new f.Mocha.Test('new owner cannot reuse quarantined session', async () => {
        nextRan = true
      })
    )
    assert.equal(await f.run(), 2, 'both owned Mocha cases must fail on session quarantine')
    assert.equal(ownerAssertionsCompleted, true, f.failures.map((x) => x.error.stack).join('\n'))
    assert.equal(nextRan, false)
    assert.equal(f.failures.length, 2)
    assert.ok(
      f.failures.every((x) => /quarantined/.test(x.error.message)),
      f.failures.map((x) => x.error.stack).join('\n')
    )
    await tick()
    assert.equal(outcome.ok, false)
    assert.equal(settled, 1)
    assert.deepEqual(f.requests, f.plan)
    assert.deepEqual(f.trace, [
      'expanded-accepted',
      'owner-aborted',
      'retire-callback',
      'expanded-complete'
    ])
    await assert.rejects(read(100), /quarantined/)
    assert.equal(f.requests.length, 4)
    assert.throws(() => f.guard.guardRequest({}), /quarantined/)
  })
})
