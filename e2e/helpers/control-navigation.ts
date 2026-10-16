import { createExpandedReader, type Protocol, type Rect } from './fast-geometry'

const referenceKey = 'element-6066-11e4-a52e-4f735466cecf'
type NativeElement = {
  elementId: string
  selector: unknown
  isDisplayed(): Promise<boolean>
  click(): Promise<unknown>
}
type Observation = {
  viewport: { reference: string; rect: Rect }
  button?: { reference: string; rect: Rect }
}
type NavigationDriver = Protocol & {
  getElementRect(reference: string): Promise<Rect>
  performActions(actions: Parameters<WebdriverIO.Browser['performActions']>[0]): Promise<unknown>
  releaseActions(): Promise<unknown>
}
type Options = {
  assertOwnerActive(): unknown
  element(
    selector: string | { 'element-6066-11e4-a52e-4f735466cecf': string }
  ): Promise<NativeElement>
  controlSelector(name: string): string
  controlsSelector: string
  pointerId?: string
  failureMessage?(name: string): string
}

function nativeRect(value: unknown): Rect {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Missing control rectangle')
  const source = value as Record<string, unknown>
  const result = {} as Rect
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const n = source[key]
    if (typeof n !== 'number' || !Number.isSafeInteger(n))
      throw new Error(`Invalid control rectangle ${key}`)
    result[key] = n
  }
  if (result.width < 0 || result.height < 0) throw new Error('Negative control size')
  return result
}

export function parseControlObservation(response: unknown, buttonName: string): Observation {
  if (!Array.isArray(response) || response.length < 1 || response.length > 2)
    throw new Error('Invalid controls match count')
  const byName = new Map<string, { reference: string; rect: Rect }>()
  const refs = new Set<string>()
  for (const raw of response) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid control match')
    const entry = raw as Record<string, unknown>
    const name = entry['attribute/name']
    if (
      typeof name !== 'string' ||
      !['two-sided-controls', buttonName].includes(name) ||
      byName.has(name)
    )
      throw new Error('Unknown or duplicate control name')
    const reference = entry[referenceKey] ?? entry.ELEMENT
    if (typeof reference !== 'string' || !reference || refs.has(reference))
      throw new Error('Missing or duplicate control reference')
    if (
      entry[referenceKey] !== undefined &&
      entry.ELEMENT !== undefined &&
      entry[referenceKey] !== entry.ELEMENT
    )
      throw new Error('Conflicting control references')
    refs.add(reference)
    byName.set(name, { reference, rect: nativeRect(entry.rect) })
  }
  const viewport = byName.get('two-sided-controls')
  if (!viewport || viewport.rect.width <= 0 || viewport.rect.height <= 0)
    throw new Error('Controls viewport unavailable')
  return { viewport, button: byName.get(buttonName) }
}

export function controlScrollActions(
  origin: Rect,
  direction: 'up' | 'down',
  pointerId = 'two-sided-scroll'
): Parameters<WebdriverIO.Browser['performActions']>[0] {
  const x = Math.round(origin.x + origin.width / 2)
  const top = Math.round(origin.y + origin.height * 0.2)
  const bottom = Math.round(origin.y + origin.height * 0.8)
  return [
    {
      type: 'pointer',
      id: pointerId,
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

export function createControlsNavigator(driver: NavigationDriver, options: Options) {
  const { assertOwnerActive } = options
  const observe = createExpandedReader(driver, {
    assertOwnerActive,
    attributes: 'rect,attribute/name'
  })
  async function owned<T>(operation: () => Promise<T>): Promise<T> {
    assertOwnerActive()
    const result = await operation()
    assertOwnerActive()
    return result
  }
  return async function tapControl(name: string): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(name) || name === 'controls') throw new Error('Invalid control name')
    const buttonName = `two-sided-${name}`
    const query = ['two-sided-controls', buttonName]
      .map((value) => `name == ${JSON.stringify(value)}`)
      .join(' OR ')
    for (let attempt = 0; attempt < 10; attempt++) {
      const observation = await observe(query, (response) =>
        parseControlObservation(response, buttonName)
      )
      let origin = observation.viewport.rect
      let direction: 'up' | 'down' = 'down'
      if (observation.button) {
        const button = await owned(() =>
          options.element({ [referenceKey]: observation.button!.reference })
        )
        // Retain WDIO's normal stale-element recovery, including its original selector.
        button.selector = options.controlSelector(name)
        const displayed = await owned(() => button.isDisplayed())
        const recovered = button.elementId !== observation.button.reference
        if (recovered) {
          // Hidden replacements also invalidate the old scrolling viewport.
          const viewport = await owned(() => options.element(options.controlsSelector))
          origin = nativeRect(await owned(() => driver.getElementRect(viewport.elementId)))
        }
        if (displayed) {
          let position = observation.button.rect
          if (recovered) {
            position = nativeRect(await owned(() => driver.getElementRect(button.elementId)))
          }
          const center = position.y + position.height / 2
          if (center > origin.y + 4 && center < origin.y + origin.height - 4) {
            await owned(() => button.click())
            return
          }
          direction = center < origin.y ? 'up' : 'down'
        }
      }
      await owned(() =>
        driver.performActions(controlScrollActions(origin, direction, options.pointerId))
      )
      await owned(() => driver.releaseActions())
    }
    throw new Error(options.failureMessage?.(name) ?? `Control ${name} did not become visible`)
  }
}
