/**
 * Element position assertion helpers for e2e tests.
 * Uses Appium's getLocation() and getSize() to verify spatial relationships.
 */

export interface ElementRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Get the bounding rect of an element by selector.
 */
export async function getElementRect(selector: string): Promise<ElementRect> {
  const el = await $(selector)
  await el.waitForDisplayed({ timeout: 5000 })
  const location = await el.getLocation()
  const size = await el.getSize()
  return {
    x: location.x,
    y: location.y,
    width: size.width,
    height: size.height
  }
}

/**
 * Assert that the content view is translated (x position differs from 0 by at least minOffset).
 * When a swipeable is open, the content should be shifted by roughly actionsWidth.
 */
export async function assertContentTranslated(
  contentSelector: string,
  minOffset: number
): Promise<void> {
  const rect = await getElementRect(contentSelector)
  const absX = Math.abs(rect.x)
  expect(absX).toBeGreaterThanOrEqual(
    minOffset * 0.5 // allow 50% tolerance for animation settling
  )
}

/**
 * Assert that the content view is at its resting position (x close to 0).
 */
export async function assertContentAtRest(
  contentSelector: string,
  tolerance: number = 5
): Promise<void> {
  const rect = await getElementRect(contentSelector)
  expect(Math.abs(rect.x)).toBeLessThanOrEqual(tolerance)
}

/**
 * Assert that an actions element is visible and positioned correctly relative to content.
 * For trailing (right) actions: actions should be to the right of where content starts.
 * For leading (left) actions: actions should be to the left.
 */
export async function assertActionsBesideContent(
  contentSelector: string,
  actionsSelector: string,
  position: 'left' | 'right'
): Promise<void> {
  const content = await getElementRect(contentSelector)
  const actions = await getElementRect(actionsSelector)

  if (position === 'right') {
    // Actions should be visible: their x should be less than the screen width
    // and they should be to the right of the content's original position
    expect(actions.width).toBeGreaterThan(0)
    // The actions panel should overlap with or be adjacent to the content's right edge
    const contentRight = content.x + content.width
    expect(actions.x).toBeLessThanOrEqual(contentRight + 5) // 5px tolerance
  } else {
    expect(actions.width).toBeGreaterThan(0)
    const contentLeft = content.x
    expect(actions.x + actions.width).toBeGreaterThanOrEqual(contentLeft - 5)
  }

  // Actions and content should share vertical space (same row)
  const contentBottom = content.y + content.height
  const actionsBottom = actions.y + actions.height
  const verticalOverlap =
    Math.min(contentBottom, actionsBottom) - Math.max(content.y, actions.y)
  expect(verticalOverlap).toBeGreaterThan(0)
}

/**
 * Assert that a child element is not clipped by a parent.
 * The child's visible area should match its full area.
 * This catches clipsToBounds issues where transforms push content outside parent bounds.
 */
export async function assertElementNotClipped(
  childSelector: string,
  parentSelector: string
): Promise<void> {
  const child = await getElementRect(childSelector)
  const parent = await getElementRect(parentSelector)

  // Child should be fully within parent bounds (with small tolerance for rounding)
  const tolerance = 2
  expect(child.x).toBeGreaterThanOrEqual(parent.x - tolerance)
  expect(child.y).toBeGreaterThanOrEqual(parent.y - tolerance)
  expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width + tolerance)
  expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height + tolerance)
}
