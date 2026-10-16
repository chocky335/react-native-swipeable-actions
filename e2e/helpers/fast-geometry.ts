export type Rect = { x: number; y: number; width: number; height: number }
type Settings = { shouldUseCompactResponses: boolean; elementResponseAttributes: string }
export type Protocol = {
  getSettings(): Promise<unknown>
  updateSettings(settings: Settings): Promise<unknown>
  findElements(using: string, value: string): Promise<unknown>
}
export type Geometry = {
  frame: Rect
  anchor: Rect
  rawText: string
  text: string
  layoutWidth: number
  scale: number
  offset: number
  layoutOffset: number
}
const expanded: Settings = {
  shouldUseCompactResponses: false,
  elementResponseAttributes: 'rect,text,attribute/name'
}
const reference = 'element-6066-11e4-a52e-4f735466cecf'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object')
  return value as Record<string, unknown>
}
function names(id: number): string[] {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error('Invalid row ID')
  return ['frame', 'anchor', 'layout'].map((part) => `two-sided-${part}-${id}`)
}
function rect(value: unknown): Rect {
  const source = object(value)
  const result = {} as Rect
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const n = source[field]
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`Invalid native rect.${field}`)
    }
    result[field] = n
  }
  if (result.width < 0 || result.height < 0) throw new Error('Negative native rect size')
  return result
}
function settings(value: unknown): Settings {
  const source = object(value)
  if (
    typeof source.shouldUseCompactResponses !== 'boolean' ||
    typeof source.elementResponseAttributes !== 'string'
  ) {
    throw new Error('Expanded response settings unavailable')
  }
  return {
    shouldUseCompactResponses: source.shouldUseCompactResponses,
    elementResponseAttributes: source.elementResponseAttributes
  }
}
function equalSettings(a: Settings, b: Settings): boolean {
  return (
    a.shouldUseCompactResponses === b.shouldUseCompactResponses &&
    a.elementResponseAttributes === b.elementResponseAttributes
  )
}

export function parseGeometry(response: unknown, id: number): Geometry {
  const expected = names(id)
  if (!Array.isArray(response) || response.length !== 3)
    throw new Error('Expected exactly three geometry matches')
  const entries = new Map<string, { rect: Rect; text: string }>()
  const references = new Set<string>()
  for (const value of response) {
    const entry = object(value)
    const name = entry['attribute/name']
    if (typeof name !== 'string' || !expected.includes(name) || entries.has(name))
      throw new Error('Unknown or duplicate geometry name')
    const key = entry[reference] ?? entry.ELEMENT
    if (typeof key !== 'string' || !key || references.has(key))
      throw new Error('Missing or duplicate element reference')
    if (
      entry[reference] !== undefined &&
      entry.ELEMENT !== undefined &&
      entry[reference] !== entry.ELEMENT
    ) {
      throw new Error('Conflicting element references')
    }
    const text = entry.text === null ? '' : entry.text
    if (typeof text !== 'string') throw new Error('Missing native text')
    references.add(key)
    entries.set(name, { rect: rect(entry.rect), text })
  }
  const frame = entries.get(expected[0])!.rect
  const anchor = entries.get(expected[1])!.rect
  const rawText = entries.get(expected[2])!.text
  const text = rawText.replace(/\s+/g, ' ').trim()
  const match = text.match(/^Row width (\d+); key (two-sided-demo-\d+)$/)
  const layoutWidth = Number(match?.[1])
  if (!(layoutWidth > 0) || !Number.isFinite(layoutWidth) || !(frame.width > 0))
    throw new Error('Invalid layout width')
  if (match?.[2] !== `two-sided-demo-${id}`) throw new Error('Stale geometry binding')
  const scale = frame.width / layoutWidth
  const offset = anchor.x + anchor.width / 2 - frame.x - frame.width / 2
  return { frame, anchor, rawText, text, layoutWidth, scale, offset, layoutOffset: offset / scale }
}

const transactionStates = new WeakMap<Protocol, { busy: boolean; unusable: boolean }>()

/** A fresh guarded observation; settings ownership is shared by all readers of this driver. */
export function createExpandedReader(
  driver: Protocol,
  { assertOwnerActive, attributes }: { assertOwnerActive: () => unknown; attributes: string }
) {
  let state = transactionStates.get(driver)
  if (!state) {
    state = { busy: false, unusable: false }
    transactionStates.set(driver, state)
  }
  const shared = state
  async function command<T>(operation: () => Promise<T>): Promise<T> {
    assertOwnerActive()
    const value = await operation()
    assertOwnerActive()
    return value
  }
  async function setAndConfirm(value: Settings): Promise<void> {
    await command(() => driver.updateSettings(value))
    const actual = settings(await command(() => driver.getSettings()))
    if (!equalSettings(value, actual))
      throw new Error('Geometry response settings were not confirmed')
  }
  return async function read<T>(query: string, parse: (response: unknown) => T): Promise<T> {
    assertOwnerActive()
    // Fail before changing shared settings rather than interleave transactions.
    if (shared.unusable)
      throw new Error('Geometry reader disabled after unconfirmed settings restoration')
    if (shared.busy) throw new Error('Concurrent geometry read is not allowed')
    shared.busy = true
    let original: Settings | undefined
    let dirty = false
    let failed = false
    let failure: unknown
    let result: T | undefined
    try {
      original = settings(await command(() => driver.getSettings()))
      dirty = true
      await setAndConfirm({
        shouldUseCompactResponses: false,
        elementResponseAttributes: attributes
      })
      const response = await command(() => driver.findElements('-ios predicate string', query))
      result = parse(response)
      assertOwnerActive()
    } catch (error) {
      failed = true
      failure = error
    }
    try {
      // Every cleanup request still passes the original owner/transport guard.
      if (dirty && original) await setAndConfirm(original)
    } catch (error) {
      shared.unusable = true
      if (!failed) {
        failed = true
        failure = error
      }
    } finally {
      shared.busy = false
    }
    if (failed) throw failure
    assertOwnerActive()
    return result!
  }
}

/** E2E-only, for the explicitly selected iOS/XCUITest protocol path. No cached geometry. */
export function createFastGeometryReader(
  driver: Protocol,
  { assertOwnerActive }: { assertOwnerActive: () => unknown }
) {
  const read = createExpandedReader(driver, {
    assertOwnerActive,
    attributes: expanded.elementResponseAttributes
  })
  return async function readGeometry(id = 0): Promise<Geometry> {
    const expected = names(id)
    return read(
      expected.map((name) => `name == ${JSON.stringify(name)}`).join(' OR '),
      (response) => parseGeometry(response, id)
    )
  }
}
