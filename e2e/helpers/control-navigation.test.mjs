import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import navigationModule from './control-navigation.ts'
import geometryModule from './fast-geometry.ts'

const { parseControlObservation, controlScrollActions, createControlsNavigator } = navigationModule
const { createFastGeometryReader, createExpandedReader } = geometryModule
const require = createRequire(import.meta.url)
const key = 'element-6066-11e4-a52e-4f735466cecf'
const original = { shouldUseCompactResponses: true, elementResponseAttributes: 'type,label' }
const controlSettings = {
  shouldUseCompactResponses: false,
  elementResponseAttributes: 'rect,attribute/name'
}
const geometrySettings = {
  shouldUseCompactResponses: false,
  elementResponseAttributes: 'rect,text,attribute/name'
}
const viewport = { x: 0, y: 240, width: 402, height: 185 }
const buttonRect = { x: 8, y: 356, width: 190, height: 45 }
const clone = (value) => structuredClone(value)
const nativeName = (name) => `two-sided-${name}`
const selector = (name) => `-ios predicate string:name == ${JSON.stringify(nativeName(name))}`
const controlQuery = (name) =>
  ['two-sided-controls', nativeName(name)].map((n) => `name == ${JSON.stringify(n)}`).join(' OR ')
const geometryQuery =
  'name == "two-sided-frame-0" OR name == "two-sided-anchor-0" OR name == "two-sided-layout-0"'
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function rows({
  name = 'right-width',
  generation = 0,
  panel = viewport,
  button = buttonRect,
  absent = false
} = {}) {
  const entry = (name, id, rect) => ({
    [key]: id,
    ELEMENT: id,
    'attribute/name': name,
    rect: clone(rect)
  })
  return [
    entry('two-sided-controls', `panel-${generation}`, panel),
    ...(!absent ? [entry(nativeName(name), `button-${generation}`, button)] : [])
  ]
}
function geometryRows() {
  return ['frame', 'anchor', 'layout'].map((part, i) => ({
    [key]: `geometry-${i}`,
    'attribute/name': `two-sided-${part}-0`,
    rect:
      i === 1
        ? { x: 200, y: 516, width: 2, height: 2 }
        : { x: 12, y: 436, width: 378, height: 101 },
    text: i === 2 ? 'Row width 378; key two-sided-demo-0' : null
  }))
}
function expectedGesture(origin, direction) {
  const x = Math.round(origin.x + origin.width / 2)
  const top = Math.round(origin.y + origin.height * 0.2)
  const bottom = Math.round(origin.y + origin.height * 0.8)
  return [
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
  ]
}
function fixture({
  response = (iteration) => rows({ generation: iteration }),
  initial = original,
  fault,
  onDisplay,
  rects = {}
} = {}) {
  const events = [],
    wrapped = []
  let settings = clone(initial),
    protocolNumber = 0,
    iteration = 0,
    retired = false
  const retiredError = new Error('owner expired')
  const assertOwnerActive = () => {
    if (retired) throw retiredError
  }
  async function call(type, argument, action, protocol = false) {
    if (protocol) protocolNumber++
    const event = { type, argument: clone(argument), protocolNumber, iteration }
    events.push(event)
    const answer = await fault?.(event)
    if (answer?.override) return answer.value
    return action()
  }
  const driver = {
    getSettings: () => call('getSettings', undefined, () => clone(settings), true),
    updateSettings: (value) =>
      call(
        'updateSettings',
        value,
        () => {
          settings = { ...settings, ...value }
          return null
        },
        true
      ),
    findElements: (using, value) =>
      call(
        'findElements',
        { using, value },
        () => {
          if (value === geometryQuery) return geometryRows()
          iteration++
          return response(iteration)
        },
        true
      ),
    getElementRect: (id) =>
      call('getElementRect', id, () => {
        assert.ok(id in rects, `No fixture rect for ${id}`)
        return clone(rects[id])
      }),
    performActions: (actions) => call('performActions', actions, () => null),
    releaseActions: () => call('releaseActions', undefined, () => null)
  }
  const options = {
    assertOwnerActive,
    controlsSelector: selector('controls'),
    controlSelector: selector,
    element: (value) =>
      call('element', value, () => {
        if (typeof value === 'string') {
          assert.equal(value, selector('controls'))
          return { elementId: 'panel-recovered', selector: value }
        }
        assert.deepEqual(Object.keys(value), [key])
        const element = {
          elementId: value[key],
          selector: value,
          isDisplayed() {
            return call('isDisplayed', { id: this.elementId, selector: this.selector }, () =>
              onDisplay ? onDisplay(this, iteration) : true
            )
          },
          click() {
            return call('click', { id: this.elementId, selector: this.selector }, () => null)
          }
        }
        wrapped.push(element)
        return element
      })
  }
  return {
    driver,
    options,
    events,
    wrapped,
    nav: createControlsNavigator(driver, options),
    geometry: createFastGeometryReader(driver, { assertOwnerActive }),
    retire() {
      retired = true
    },
    retiredError,
    get settings() {
      return clone(settings)
    },
    get iterations() {
      return iteration
    }
  }
}
const typed = (f, type) => f.events.filter((e) => e.type === type)
const transactionTypes = [
  'getSettings',
  'updateSettings',
  'getSettings',
  'findElements',
  'updateSettings',
  'getSettings'
]

for (const mode of ['dual', 'w3c', 'legacy']) {
  test(`parse controls accepts ${mode} references and unordered matches`, () => {
    const data = rows()
    for (const r of data) {
      if (mode === 'w3c') delete r.ELEMENT
      if (mode === 'legacy') delete r[key]
    }
    assert.deepEqual(parseControlObservation(data.reverse(), 'two-sided-right-width'), {
      viewport: { reference: 'panel-0', rect: viewport },
      button: { reference: 'button-0', rect: buttonRect }
    })
  })
}
test('absent button is valid but missing viewport is not', () => {
  assert.deepEqual(parseControlObservation(rows({ absent: true }), 'two-sided-right-width'), {
    viewport: { reference: 'panel-0', rect: viewport },
    button: undefined
  })
  assert.throws(
    () => parseControlObservation(rows().slice(1), 'two-sided-right-width'),
    /viewport unavailable/
  )
})
const malformed = [
  ['null response', () => null, /match count/],
  ['object response', () => ({}), /match count/],
  ['empty response', () => [], /match count/],
  ['three matches', (p) => [...p, p[0]], /match count/],
  [
    'null entry',
    (p) => {
      p[0] = null
    },
    /Invalid control match/
  ],
  [
    'array entry',
    (p) => {
      p[0] = []
    },
    /Invalid control match/
  ],
  [
    'missing name',
    (p) => {
      delete p[0]['attribute/name']
    },
    /control name/
  ],
  [
    'name alias',
    (p) => {
      p[0].name = p[0]['attribute/name']
      delete p[0]['attribute/name']
    },
    /control name/
  ],
  [
    'numeric name',
    (p) => {
      p[0]['attribute/name'] = 12
    },
    /control name/
  ],
  [
    'wrong target name',
    (p) => {
      p[1]['attribute/name'] = 'two-sided-left-width'
    },
    /control name/
  ],
  [
    'duplicate viewport',
    (p) => {
      p[1]['attribute/name'] = 'two-sided-controls'
    },
    /control name/
  ],
  [
    'duplicate button',
    (p) => {
      p[0]['attribute/name'] = 'two-sided-right-width'
    },
    /control name/
  ],
  [
    'no reference',
    (p) => {
      delete p[0][key]
      delete p[0].ELEMENT
    },
    /control reference/
  ],
  [
    'empty reference',
    (p) => {
      p[0][key] = ''
      p[0].ELEMENT = ''
    },
    /control reference/
  ],
  [
    'numeric reference',
    (p) => {
      p[0][key] = 1
      p[0].ELEMENT = 1
    },
    /control reference/
  ],
  [
    'duplicate reference',
    (p) => {
      p[1][key] = p[0][key]
      p[1].ELEMENT = p[0].ELEMENT
    },
    /control reference/
  ],
  [
    'conflicting dual references',
    (p) => {
      p[0].ELEMENT = 'different'
    },
    /Conflicting control references/
  ],
  [
    'null W3C plus nonnull legacy conflicts',
    (p) => {
      p[0][key] = null
    },
    /Conflicting control references/
  ],
  [
    'null rect',
    (p) => {
      p[1].rect = null
    },
    /Missing control rectangle/
  ],
  [
    'missing rect',
    (p) => {
      delete p[1].rect
    },
    /Missing control rectangle/
  ],
  [
    'array rect',
    (p) => {
      p[1].rect = []
    },
    /Missing control rectangle/
  ],
  [
    'negative viewport size',
    (p) => {
      p[0].rect.width = -1
    },
    /Negative control size/
  ],
  [
    'negative button size',
    (p) => {
      p[1].rect.height = -1
    },
    /Negative control size/
  ],
  [
    'zero viewport width',
    (p) => {
      p[0].rect.width = 0
    },
    /viewport unavailable/
  ],
  [
    'zero viewport height',
    (p) => {
      p[0].rect.height = 0
    },
    /viewport unavailable/
  ]
]
for (const index of [0, 1])
  for (const field of ['x', 'y', 'width', 'height']) {
    for (const value of [
      undefined,
      '1',
      NaN,
      Infinity,
      -Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      malformed.push([
        `entry${index}.${field}=${String(value)} (${typeof value})`,
        (p) => {
          p[index].rect[field] = value
        },
        /Invalid control rectangle/
      ])
    }
  }
for (const [label, mutate, error] of malformed)
  test(`malformed/ambiguous controls: ${label}`, () => {
    const data = rows()
    const changed = mutate(data)
    assert.throws(
      () =>
        parseControlObservation(changed === undefined ? data : changed, 'two-sided-right-width'),
      error
    )
  })
test('negative coordinates and zero-sized button remain parser-valid', () => {
  const data = rows({
    panel: { x: -10, y: -20, width: 402, height: 185 },
    button: { x: -1, y: -2, width: 0, height: 0 }
  })
  assert.deepEqual(parseControlObservation(data, 'two-sided-right-width').button.rect, data[1].rect)
})
for (const direction of ['up', 'down'])
  test(`exact ${direction} gesture retains 60 percent, 450+150 and pointer release`, () => {
    const result = controlScrollActions(viewport, direction)
    assert.deepEqual(result, expectedGesture(viewport, direction))
    assert.equal(result[0].actions[0].x, 201)
    assert.equal(Math.abs(result[0].actions[2].y - result[0].actions[0].y), 111)
    assert.deepEqual(viewport, { x: 0, y: 240, width: 402, height: 185 })
    const odd = { x: 3, y: 7, width: 101, height: 103 }
    assert.deepEqual(controlScrollActions(odd, direction), expectedGesture(odd, direction))
  })
for (const name of [
  '',
  'controls',
  'Right-width',
  '../right-width',
  'right_width',
  'right width',
  'right" OR true'
]) {
  test(`invalid name ${JSON.stringify(name)} sends no requests`, async () => {
    const f = fixture()
    await assert.rejects(f.nav(name), /Invalid control name/)
    assert.deepEqual(f.events, [])
  })
}
for (const initial of [
  original,
  { shouldUseCompactResponses: false, elementResponseAttributes: ' rect, label ' }
]) {
  test(`healthy navigation exact shared six-request transaction restores ${JSON.stringify(initial)}`, async () => {
    const f = fixture({ initial })
    await f.nav('right-width')
    assert.deepEqual(
      f.events.map((e) => e.type),
      [...transactionTypes, 'element', 'isDisplayed', 'click']
    )
    assert.deepEqual(
      typed(f, 'updateSettings').map((e) => e.argument),
      [controlSettings, initial]
    )
    assert.deepEqual(typed(f, 'findElements')[0].argument, {
      using: '-ios predicate string',
      value: controlQuery('right-width')
    })
    assert.deepEqual(typed(f, 'element')[0].argument, { [key]: 'button-1' })
    assert.equal(typed(f, 'isDisplayed')[0].argument.selector, selector('right-width'))
    assert.equal(typed(f, 'click')[0].argument.selector, selector('right-width'))
    assert.deepEqual(f.settings, initial)
  })
}
for (const [center, click, direction] of [
  [239, false, 'up'],
  [240, false, 'down'],
  [244, false, 'down'],
  [245, true],
  [420, true],
  [421, false, 'down'],
  [425, false, 'down'],
  [426, false, 'down']
]) {
  test(`strict center bound ${center}: ${click ? 'click' : direction + ' scroll'}`, async () => {
    const f = fixture({
      response: (i) =>
        rows({
          generation: i,
          button: i === 1 ? { ...buttonRect, y: center - 1, height: 2 } : buttonRect
        })
    })
    await f.nav('right-width')
    assert.equal(f.iterations, click ? 1 : 2)
    assert.equal(typed(f, 'click').length, 1)
    if (click) assert.equal(typed(f, 'performActions').length, 0)
    else {
      assert.deepEqual(typed(f, 'performActions')[0].argument, expectedGesture(viewport, direction))
      assert.equal(typed(f, 'releaseActions').length, 1)
      assert.equal(typed(f, 'click')[0].argument.id, 'button-2')
    }
  })
}
test('hidden target above panel still preserves default down direction', async () => {
  const f = fixture({
    response: (i) =>
      rows({ generation: i, button: i === 1 ? { ...buttonRect, y: 0 } : buttonRect }),
    onDisplay: (_, i) => i > 1
  })
  await f.nav('right-width')
  assert.deepEqual(typed(f, 'performActions')[0].argument, expectedGesture(viewport, 'down'))
  assert.equal(f.iterations, 2)
})
test('absent button then hidden button then visible button uses fresh references and panel every iteration', async () => {
  const panels = [viewport, { ...viewport, y: 500 }, { ...viewport, y: 700 }]
  const f = fixture({
    response: (i) =>
      rows({
        generation: i,
        panel: panels[i - 1],
        absent: i === 1,
        button: { ...buttonRect, y: panels[i - 1].y + 80 }
      }),
    onDisplay: (_, i) => i === 3
  })
  await f.nav('right-width')
  assert.equal(f.iterations, 3)
  assert.equal(typed(f, 'findElements').length, 3)
  assert.deepEqual(
    typed(f, 'performActions').map((e) => e.argument),
    [expectedGesture(panels[0], 'down'), expectedGesture(panels[1], 'down')]
  )
  assert.deepEqual(
    typed(f, 'element').map((e) => e.argument),
    [{ [key]: 'button-2' }, { [key]: 'button-3' }]
  )
  assert.equal(typed(f, 'releaseActions').length, 2)
  assert.equal(typed(f, 'click')[0].argument.id, 'button-3')
  assert.deepEqual(f.settings, original)
})
for (const hidden of [false, true])
  test(`max ten observations/gestures/releases; no eleventh attempt (${hidden ? 'hidden' : 'absent'})`, async () => {
    const f = fixture({
      response: (i) => rows({ generation: i, absent: !hidden }),
      onDisplay: () => false
    })
    await assert.rejects(
      f.nav('right-width'),
      /^Error: Control right-width did not become visible$/
    )
    assert.equal(f.iterations, 10)
    assert.equal(typed(f, 'findElements').length, 10)
    assert.equal(typed(f, 'performActions').length, 10)
    assert.equal(typed(f, 'releaseActions').length, 10)
    assert.equal(typed(f, 'click').length, 0)
    // The first observation captures the baseline; later ones reuse the confirmed restoration.
    assert.equal(typed(f, 'getSettings').length, 3 + 9 * 2)
    for (const event of typed(f, 'performActions')) {
      const index = f.events.indexOf(event)
      assert.equal(f.events[index + 1].type, 'releaseActions')
      assert.deepEqual(event.argument, expectedGesture(viewport, 'down'))
    }
    assert.deepEqual(f.settings, original)
  })
for (const behavior of ['click', 'scroll'])
  test(`visible changed-ID recovery refreshes selector, viewport and target before ${behavior}`, async () => {
    const movedPanel = { x: 20, y: 500, width: 302, height: 155 }
    const newButton = { x: 28, y: behavior === 'click' ? 550 : 450, width: 190, height: 20 }
    const f = fixture({
      response: (i) => rows({ generation: i }),
      onDisplay: (element, i) => {
        if (i === 1) element.elementId = 'button-recovered'
        return true
      },
      rects: { 'panel-recovered': movedPanel, 'button-recovered': newButton }
    })
    await f.nav('right-width')
    assert.deepEqual(
      typed(f, 'getElementRect').map((e) => e.argument),
      ['panel-recovered', 'button-recovered']
    )
    assert.equal(f.wrapped[0].selector, selector('right-width'))
    assert.equal(typed(f, 'element')[1].argument, selector('controls'))
    assert.equal(f.iterations, behavior === 'click' ? 1 : 2)
    if (behavior === 'scroll')
      assert.deepEqual(typed(f, 'performActions')[0].argument, expectedGesture(movedPanel, 'up'))
    else assert.equal(typed(f, 'click')[0].argument.id, 'button-recovered')
  })
test('REGRESSION: hidden changed-ID recovery scrolls fresh moved viewport without extra attempts', async () => {
  const movedPanel = { x: 20, y: 500, width: 302, height: 155 }
  const f = fixture({
    response: (i) =>
      rows({
        generation: i,
        panel: i === 1 ? viewport : movedPanel,
        button: { ...buttonRect, y: i === 1 ? 356 : 550 }
      }),
    onDisplay: (element, i) => {
      if (i === 1) {
        element.elementId = 'button-recovered'
        return false
      }
      return true
    },
    rects: { 'panel-recovered': movedPanel, 'button-recovered': { ...buttonRect, y: 800 } }
  })
  await f.nav('right-width')
  assert.equal(f.iterations, 2, 'exactly the original hidden and visible observations')
  assert.equal(typed(f, 'performActions').length, 1)
  assert.equal(typed(f, 'releaseActions').length, 1)
  assert.equal(typed(f, 'click').length, 1)
  assert.deepEqual(
    typed(f, 'performActions')[0].argument,
    expectedGesture(movedPanel, 'down'),
    'a replacement found hidden must not scroll using the old viewport'
  )
  assert.ok(typed(f, 'getElementRect').some((e) => e.argument === 'panel-recovered'))
})
for (const stage of [
  'capture',
  'expand',
  'confirm',
  'query',
  'restore',
  'restore-confirm',
  'element',
  'isDisplayed',
  'click',
  'performActions',
  'releaseActions'
]) {
  test(`original error identity at ${stage}, no navigation fallback`, async () => {
    const failure = new Error(`original ${stage}`)
    const protocolStage =
      ['capture', 'expand', 'confirm', 'query', 'restore', 'restore-confirm'].indexOf(stage) + 1
    const f = fixture({
      response: () => rows({ absent: ['performActions', 'releaseActions'].includes(stage) }),
      fault: (e) => {
        if (
          (protocolStage && e.protocolNumber === protocolStage) ||
          (!protocolStage && e.type === stage)
        )
          throw failure
      }
    })
    await assert.rejects(f.nav('right-width'), (e) => e === failure)
    assert.equal(typed(f, 'findElements').length <= 1, true)
    if (stage === 'performActions') assert.equal(typed(f, 'releaseActions').length, 0)
    if (stage !== 'click') assert.equal(typed(f, 'click').length, 0)
  })
}
test('parser rejection restores settings, never constructs a wrapper', async () => {
  const f = fixture({ response: () => [] })
  await assert.rejects(f.nav('right-width'), /match count/)
  assert.deepEqual(
    f.events.map((e) => e.type),
    transactionTypes
  )
  assert.deepEqual(f.settings, original)
})
for (const error of [new Error('query failed'), undefined, null, 'thrown string'])
  test(`primary query identity beats cleanup failure: ${String(error)}`, async () => {
    const f = fixture({
      fault: (e) => {
        if (e.protocolNumber === 4) throw error
        if (e.protocolNumber === 5) throw new Error('cleanup failed')
      }
    })
    const outcome = await f.nav('right-width').then(
      () => ({ ok: true }),
      (actual) => ({ ok: false, actual })
    )
    assert.equal(outcome.ok, false)
    assert.strictEqual(outcome.actual, error)
    const count = f.events.length
    await assert.rejects(f.geometry(), /disabled/)
    assert.equal(f.events.length, count)
  })
for (const holder of ['controls', 'geometry'])
  for (const blockedAt of [1, 4, 5]) {
    test(`shared concurrency: ${holder} holds transaction at request ${blockedAt}`, async () => {
      const reached = deferred(),
        release = deferred()
      const f = fixture({
        fault: async (e) => {
          if (e.protocolNumber === blockedAt) {
            reached.resolve()
            await release.promise
          }
        }
      })
      const running = holder === 'controls' ? f.nav('right-width') : f.geometry()
      await reached.promise
      const count = f.events.length
      await assert.rejects(f.nav('right-width'), /Concurrent geometry/)
      await assert.rejects(f.geometry(), /Concurrent geometry/)
      await assert.rejects(
        createControlsNavigator(f.driver, f.options)('right-width'),
        /Concurrent geometry/
      )
      await assert.rejects(createFastGeometryReader(f.driver, f.options)(), /Concurrent geometry/)
      assert.equal(f.events.length, count)
      release.resolve()
      await running
      if (holder === 'controls') await f.geometry()
      else await f.nav('right-width')
      assert.deepEqual(f.settings, original)
      assert.deepEqual(
        typed(f, 'updateSettings').map((e) => e.argument),
        holder === 'controls'
          ? [controlSettings, original, geometrySettings, original]
          : [geometrySettings, original, controlSettings, original]
      )
    })
  }
for (const holder of ['controls', 'geometry'])
  for (const mode of ['restore error', 'restore-confirm error', 'restore-confirm mismatch']) {
    test(`shared poison: ${holder} ${mode} blocks existing and new readers without requests`, async () => {
      const failure = new Error(mode)
      const f = fixture({
        fault: (e) => {
          if (mode === 'restore error' && e.protocolNumber === 5) throw failure
          if (mode === 'restore-confirm error' && e.protocolNumber === 6) throw failure
          if (mode === 'restore-confirm mismatch' && e.protocolNumber === 6)
            return { override: true, value: controlSettings }
        }
      })
      await assert.rejects(
        holder === 'controls' ? f.nav('right-width') : f.geometry(),
        mode.endsWith('mismatch') ? /not confirmed/ : (e) => e === failure
      )
      const count = f.events.length
      for (const read of [
        () => f.nav('right-width'),
        () => f.geometry(),
        () => createControlsNavigator(f.driver, f.options)('right-width'),
        () => createFastGeometryReader(f.driver, f.options)(),
        () =>
          createExpandedReader(f.driver, { ...f.options, attributes: 'rect' })('ignored', (x) => x)
      ]) {
        await assert.rejects(read(), /disabled after unconfirmed/)
      }
      assert.equal(f.events.length, count)
      const separate = fixture()
      await separate.nav('right-width')
      await separate.geometry()
      assert.equal(typed(separate, 'findElements').length, 2)
    })
  }
test('shared transaction accepts arbitrary parser result and preserves parse error identity', async () => {
  const f = fixture()
  const read = createExpandedReader(f.driver, { ...f.options, attributes: 'rect,attribute/name' })
  const sentinel = { parsed: true }
  assert.strictEqual(await read(controlQuery('right-width'), () => sentinel), sentinel)
  const failure = new Error('original parser')
  await assert.rejects(
    read(controlQuery('right-width'), () => {
      throw failure
    }),
    (e) => e === failure
  )
  assert.deepEqual(f.settings, original)
  await f.geometry()
})
test('expired owner before entry blocks geometry and controls with zero calls', async () => {
  const f = fixture()
  f.retire()
  await assert.rejects(f.nav('right-width'), (e) => e === f.retiredError)
  await assert.rejects(f.geometry(), (e) => e === f.retiredError)
  assert.deepEqual(f.events, [])
})
for (const stage of [
  'query',
  'element',
  'isDisplayed',
  'performActions',
  'releaseActions',
  'click'
]) {
  test(`expiry after ${stage} prevents every later wrapper/driver call`, async () => {
    let f
    f = fixture({
      response: () => rows({ absent: ['performActions', 'releaseActions'].includes(stage) }),
      fault: (e) => {
        if (e.type === (stage === 'query' ? 'findElements' : stage)) f.retire()
      }
    })
    await assert.rejects(f.nav('right-width'), (e) => e === f.retiredError)
    assert.equal(f.events.at(-1).type, stage === 'query' ? 'findElements' : stage)
    const count = f.events.length
    await assert.rejects(f.nav('right-width'), (e) => e === f.retiredError)
    await assert.rejects(f.geometry(), (e) => e === f.retiredError)
    assert.equal(f.events.length, count)
  })
}
test('late expanded response after owner expiry cannot parse, wrap, restore, or recover', async () => {
  const accepted = deferred(),
    release = deferred()
  const f = fixture({
    response: () => {
      accepted.resolve()
      return release.promise
    }
  })
  const running = f.nav('right-width')
  const outcome = running.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  )
  await accepted.promise
  f.retire()
  release.resolve(rows())
  const settled = await outcome
  assert.equal(settled.ok, false)
  assert.strictEqual(settled.error, f.retiredError)
  assert.deepEqual(
    f.events.map((e) => e.type),
    transactionTypes.slice(0, 4)
  )
})

// Installed WDIO browser/element wrappers, real stale recovery middleware, and
// strictly offline transport. No session creation, sockets, or device commands.
test('REAL installed WDIO: protocol-object wrapping retains selector recovery and refreshes changed-ID geometry', {
  timeout: 10000
}, async () => {
  const { MockAgent, Dispatcher, getGlobalDispatcher, setGlobalDispatcher } = require('undici')
  const { attach } = await import('webdriverio')
  const mock = new MockAgent()
  mock.disableNetConnect()
  const origin = 'http://control-navigation-offline.invalid'
  const prefix = '/session/offline-controls'
  const raw = rows({ generation: 'old' })
  const recoveredPanel = { x: 20, y: 500, width: 302, height: 155 }
  const recoveredButton = { x: 28, y: 550, width: 190, height: 20 }
  const plan = [
    { method: 'GET', path: `${prefix}/appium/settings`, value: original },
    {
      method: 'POST',
      path: `${prefix}/appium/settings`,
      body: { settings: controlSettings },
      value: null
    },
    { method: 'GET', path: `${prefix}/appium/settings`, value: controlSettings },
    {
      method: 'POST',
      path: `${prefix}/elements`,
      body: { using: '-ios predicate string', value: controlQuery('right-width') },
      value: raw
    },
    {
      method: 'POST',
      path: `${prefix}/appium/settings`,
      body: { settings: original },
      value: null
    },
    { method: 'GET', path: `${prefix}/appium/settings`, value: original },
    {
      method: 'GET',
      path: `${prefix}/element/button-old/displayed`,
      status: 404,
      value: { error: 'stale element reference', message: 'original stale button', stacktrace: '' }
    },
    {
      method: 'POST',
      path: `${prefix}/element`,
      body: { using: '-ios predicate string', value: 'name == "two-sided-right-width"' },
      value: { [key]: 'button-recovered' }
    },
    // The nested protocol-command middleware first retries its captured old-ID
    // argument. A second stale reply lets the outer isDisplayed wrapper recover.
    {
      method: 'GET',
      path: `${prefix}/element/button-old/displayed`,
      status: 404,
      value: {
        error: 'stale element reference',
        message: 'old button remains stale',
        stacktrace: ''
      }
    },
    {
      method: 'POST',
      path: `${prefix}/element`,
      body: { using: '-ios predicate string', value: 'name == "two-sided-right-width"' },
      value: { [key]: 'button-recovered' }
    },
    { method: 'GET', path: `${prefix}/element/button-recovered/displayed`, value: true },
    {
      method: 'POST',
      path: `${prefix}/element`,
      body: { using: '-ios predicate string', value: 'name == "two-sided-controls"' },
      value: { [key]: 'panel-recovered' }
    },
    { method: 'GET', path: `${prefix}/element/panel-recovered/rect`, value: recoveredPanel },
    { method: 'GET', path: `${prefix}/element/button-recovered/rect`, value: recoveredButton },
    { method: 'POST', path: `${prefix}/element/button-recovered/click`, body: {}, value: null }
  ]
  const requests = [],
    violations = []
  for (const step of plan)
    mock
      .get(origin)
      .intercept({
        method: step.method,
        path: step.path,
        ...(step.body === undefined ? {} : { body: JSON.stringify(step.body) })
      })
      .reply(
        step.status ?? 200,
        { value: step.value },
        { headers: { 'content-type': 'application/json' } }
      )
  class OfflineOnlyDispatcher extends Dispatcher {
    dispatch(options, handler) {
      ;(async () => {
        const chunks = []
        if (typeof options.body === 'string' || Buffer.isBuffer(options.body))
          chunks.push(Buffer.from(options.body))
        else if (options.body != null)
          for await (const chunk of options.body) chunks.push(Buffer.from(chunk))
        const body = options.body == null ? undefined : Buffer.concat(chunks).toString('utf8')
        assert.equal(new URL(String(options.origin)).origin, origin)
        const actual = {
          method: options.method,
          path: options.path,
          ...(body === undefined ? {} : { body: JSON.parse(body) })
        }
        const step = plan[requests.length]
        requests.push(actual)
        assert.ok(step, 'no extra HTTP calls')
        assert.deepEqual(actual, {
          method: step.method,
          path: step.path,
          ...(step.body === undefined ? {} : { body: step.body })
        })
        mock.dispatch({ ...options, origin, body }, handler)
      })().catch((error) => {
        violations.push(error)
        handler.onError(error)
      })
      return true
    }
  }
  const previous = getGlobalDispatcher()
  setGlobalDispatcher(new OfflineOnlyDispatcher())
  try {
    const browser = await attach({
      sessionId: 'offline-controls',
      protocol: 'http',
      hostname: 'control-navigation-offline.invalid',
      port: 80,
      path: '/',
      logLevel: 'silent',
      connectionRetryCount: 0,
      connectionRetryTimeout: 1000,
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
      isW3C: true
    })
    let wrapped
    const nav = createControlsNavigator(browser, {
      assertOwnerActive() {},
      controlSelector: selector,
      controlsSelector: selector('controls'),
      async element(value) {
        const count = requests.length
        const element = await browser.$(value)
        if (typeof value === 'object') {
          assert.equal(requests.length, count, 'protocol-object wrapping must not refind')
          assert.equal(element.elementId, 'button-old')
          assert.equal(
            element.selector,
            undefined,
            'protocol-object wrapper initially lacks selector metadata'
          )
          wrapped = element
        }
        return element
      }
    })
    await nav('right-width')
    assert.equal(wrapped.selector, selector('right-width'))
    assert.equal(wrapped.elementId, 'button-recovered')
    assert.equal(requests.length, 15)
    assert.deepEqual(violations, [])
    mock.assertNoPendingInterceptors()
  } finally {
    setGlobalDispatcher(previous)
    await mock.close()
  }
})

test('custom pointerId preserves both gesture directions and navigator release behavior', async () => {
  const pointerId = 'rtl-controls-scroll'
  for (const direction of ['up', 'down']) {
    const expected = expectedGesture(viewport, direction)
    expected[0].id = pointerId
    assert.deepEqual(controlScrollActions(viewport, direction, pointerId), expected)
  }
  const f = fixture({
    response: (iteration) => rows({ generation: iteration, absent: iteration === 1 })
  })
  const navigate = createControlsNavigator(f.driver, { ...f.options, pointerId })
  await navigate('right-width')
  const expected = expectedGesture(viewport, 'down')
  expected[0].id = pointerId
  assert.deepEqual(
    typed(f, 'performActions').map((event) => event.argument),
    [expected]
  )
  assert.equal(f.iterations, 2)
  assert.equal(typed(f, 'releaseActions').length, 1)
  assert.equal(typed(f, 'click').length, 1)
  const gestureIndex = f.events.findIndex((event) => event.type === 'performActions')
  assert.equal(f.events[gestureIndex + 1].type, 'releaseActions')
  assert.deepEqual(f.settings, original)
})

test('custom failureMessage receives the name only after ten exhausted attempts and releases', async () => {
  const f = fixture({ response: (iteration) => rows({ generation: iteration, absent: true }) })
  const messages = []
  const expectedMessage = 'RTL control right-width did not become visible'
  const navigate = createControlsNavigator(f.driver, {
    ...f.options,
    failureMessage(name) {
      messages.push({ name, iterations: f.iterations, releases: typed(f, 'releaseActions').length })
      return `RTL control ${name} did not become visible`
    }
  })
  await assert.rejects(
    navigate('right-width'),
    (error) => error instanceof Error && error.message === expectedMessage
  )
  assert.deepEqual(messages, [{ name: 'right-width', iterations: 10, releases: 10 }])
  assert.equal(typed(f, 'findElements').length, 10)
  assert.equal(typed(f, 'performActions').length, 10)
  assert.equal(typed(f, 'releaseActions').length, 10)
  assert.equal(typed(f, 'click').length, 0)
  assert.equal(f.events.at(-1).type, 'releaseActions')
  assert.deepEqual(f.settings, original)
})
