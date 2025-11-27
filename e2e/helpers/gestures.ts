/**
 * Gesture utilities for Appium tests
 * Converts percentage-based coordinates (like Maestro) to pixel coordinates
 */

interface SwipeOptions {
  duration?: number
}

/**
 * Get screen dimensions
 */
async function getScreenSize(): Promise<{ width: number; height: number }> {
  const { width, height } = await driver.getWindowSize()
  return { width, height }
}

/**
 * Convert percentage string (e.g., "90%") to pixel value
 */
function percentToPixel(percent: string, dimension: number): number {
  const value = parseInt(percent.replace('%', ''), 10)
  return Math.floor((value / 100) * dimension)
}

/**
 * Swipe from one point to another using percentage-based coordinates
 * Similar to Maestro's swipe: start: 90%, 35% end: 20%, 35%
 */
export async function swipe(
  startXPercent: string,
  startYPercent: string,
  endXPercent: string,
  endYPercent: string,
  options: SwipeOptions = {}
): Promise<void> {
  const { width, height } = await getScreenSize()
  const duration = options.duration || 300

  const startX = percentToPixel(startXPercent, width)
  const startY = percentToPixel(startYPercent, height)
  const endX = percentToPixel(endXPercent, width)
  const endY = percentToPixel(endYPercent, height)

  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration, origin: 'viewport', x: endX, y: endY },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ])

  await driver.releaseActions()
}

/**
 * Swipe left to reveal trailing actions (like Maestro swipe from 90% to 20%)
 */
export async function swipeLeft(yPercent: string = '35%'): Promise<void> {
  await swipe('90%', yPercent, '20%', yPercent)
}

/**
 * Swipe right to close or reveal leading actions
 */
export async function swipeRight(yPercent: string = '35%'): Promise<void> {
  await swipe('20%', yPercent, '90%', yPercent)
}

/**
 * Scroll down (swipe up gesture)
 */
export async function scrollDown(): Promise<void> {
  await swipe('50%', '70%', '50%', '30%')
}

/**
 * Scroll up (swipe down gesture)
 */
export async function scrollUp(): Promise<void> {
  await swipe('50%', '30%', '50%', '70%')
}

/**
 * Swipe on a specific element
 */
export async function swipeOnElement(
  element: WebdriverIO.Element,
  direction: 'left' | 'right',
  duration: number = 300
): Promise<void> {
  const location = await element.getLocation()
  const size = await element.getSize()

  const centerY = location.y + size.height / 2
  const startX =
    direction === 'left' ? location.x + size.width * 0.9 : location.x + size.width * 0.1
  const endX = direction === 'left' ? location.x + size.width * 0.1 : location.x + size.width * 0.9

  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.floor(startX), y: Math.floor(centerY) },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        {
          type: 'pointerMove',
          duration,
          origin: 'viewport',
          x: Math.floor(endX),
          y: Math.floor(centerY)
        },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ])

  await driver.releaseActions()
}
