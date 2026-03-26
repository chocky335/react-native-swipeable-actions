/**
 * Screenshot comparison utility for visual regression testing.
 * Uses WDIO element screenshots with base64 comparison.
 *
 * Set SKIP_SCREENSHOT_DIFF=1 to skip screenshot assertions (for CI stability).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'swipeable-e2e-screenshots')

function ensureDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
}

/**
 * Take a screenshot of a specific element and save it.
 * Returns the base64 string for comparison.
 */
export async function takeElementScreenshot(
  selector: string,
  name: string
): Promise<string> {
  ensureDir()
  const el = await $(selector)
  await el.waitForDisplayed({ timeout: 5000 })
  const base64 = await el.takeScreenshot()
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  fs.writeFileSync(filePath, base64, 'base64')
  return base64
}

/**
 * Compare two base64 screenshot strings.
 * Returns whether they match within the threshold.
 *
 * Uses a simple byte-level comparison of the base64 data.
 * For pixel-accurate comparison, a library like pixelmatch would be needed,
 * but base64 comparison catches any rendering difference.
 */
export function compareScreenshots(
  base64A: string,
  base64B: string,
  threshold: number = 0.01
): { match: boolean; diffPercent: number } {
  if (base64A === base64B) {
    return { match: true, diffPercent: 0 }
  }

  // Compare byte-by-byte from the raw buffers
  const bufA = Buffer.from(base64A, 'base64')
  const bufB = Buffer.from(base64B, 'base64')

  // If sizes differ significantly, definitely different
  if (Math.abs(bufA.length - bufB.length) > bufA.length * 0.1) {
    return { match: false, diffPercent: 1.0 }
  }

  const minLen = Math.min(bufA.length, bufB.length)
  const maxLen = Math.max(bufA.length, bufB.length)
  let diffBytes = maxLen - minLen // extra bytes count as diff

  for (let i = 0; i < minLen; i++) {
    if (bufA[i] !== bufB[i]) {
      diffBytes++
    }
  }

  const diffPercent = diffBytes / maxLen
  return {
    match: diffPercent <= threshold,
    diffPercent
  }
}

/**
 * Whether screenshot assertions should be skipped (for CI stability).
 */
export function isScreenshotDiffEnabled(): boolean {
  return process.env.SKIP_SCREENSHOT_DIFF !== '1'
}

/**
 * Assert visual stability: take screenshots at multiple points after an action
 * and verify they all match (no flickering).
 *
 * @param selector - element to screenshot
 * @param action - async function that triggers the change (e.g., reorder)
 * @param options - timing configuration
 */
export async function assertVisualStability(
  selector: string,
  action: () => Promise<void>,
  options: {
    settleTime?: number
    sampleIntervals?: number[]
    threshold?: number
  } = {}
): Promise<void> {
  if (!isScreenshotDiffEnabled()) {
    // Still perform the action even when screenshots are skipped
    await action()
    return
  }

  const {
    settleTime = 500,
    sampleIntervals = [100, 300, 500],
    threshold = 0.02
  } = options

  // Take baseline before the action
  const baseline = await takeElementScreenshot(selector, 'stability-baseline')

  // Perform the action
  await action()

  // Take samples at each interval
  const samples: string[] = []
  for (const interval of sampleIntervals) {
    await driver.pause(interval - (sampleIntervals[sampleIntervals.indexOf(interval) - 1] ?? 0))
    const sample = await takeElementScreenshot(
      selector,
      `stability-sample-${interval}ms`
    )
    samples.push(sample)
  }

  // All post-settle samples should match each other (no ongoing flicker)
  for (let i = 1; i < samples.length; i++) {
    const result = compareScreenshots(samples[i - 1], samples[i], threshold)
    expect(result.match).toBe(true)
  }

  // Final sample should match baseline (same visual state preserved)
  const finalResult = compareScreenshots(baseline, samples[samples.length - 1], threshold)
  expect(finalResult.match).toBe(true)
}
