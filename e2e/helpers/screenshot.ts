/**
 * Screenshot comparison utility for visual regression testing.
 * Uses full-viewport screenshots cropped below the status bar
 * to avoid clock/signal changes between captures.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PNG } from 'pngjs'

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'swipeable-e2e-screenshots')

function ensureDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
}

/**
 * Take a full-viewport screenshot, crop out the status bar, save and return raw pixels.
 * Status bar height is ~54pt on iPhone (162px at 3x, 108px at 2x).
 */
export async function takeViewportScreenshot(name: string): Promise<{ png: PNG; base64: string }> {
  ensureDir()
  const base64 = await driver.takeScreenshot()
  const full = PNG.sync.read(Buffer.from(base64, 'base64'))

  // Status bar is ~54pt. Detect scale from known iPhone widths.
  const scale = full.width <= 750 ? 2 : 3
  const statusBarPx = 54 * scale

  const cropY = statusBarPx
  const cropHeight = full.height - cropY
  const cropped = new PNG({ width: full.width, height: cropHeight })
  PNG.bitblt(full, cropped, 0, cropY, full.width, cropHeight, 0, 0)

  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  fs.writeFileSync(filePath, PNG.sync.write(cropped))

  return { png: cropped, base64: PNG.sync.write(cropped).toString('base64') }
}

/**
 * Compare two PNG images pixel-by-pixel.
 * Returns the percentage of pixels that differ beyond the color threshold.
 */
export function compareImages(
  a: PNG,
  b: PNG,
  pixelThreshold: number = 0.01
): { match: boolean; diffPercent: number } {
  if (a.width !== b.width || a.height !== b.height) {
    return { match: false, diffPercent: 1.0 }
  }

  const totalPixels = a.width * a.height
  let diffPixels = 0

  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i])
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1])
    const db = Math.abs(a.data[i + 2] - b.data[i + 2])
    // Pixel differs if any channel changes by more than 2 (anti-aliasing tolerance)
    if (dr > 2 || dg > 2 || db > 2) {
      diffPixels++
    }
  }

  const diffPercent = diffPixels / totalPixels
  return {
    match: diffPercent <= pixelThreshold,
    diffPercent
  }
}

// Re-export legacy functions for existing tests that use them
export { takeViewportScreenshot as takeElementScreenshot }
export function compareScreenshots(
  base64A: string,
  base64B: string,
  threshold: number = 0.01
): { match: boolean; diffPercent: number } {
  if (base64A === base64B) return { match: true, diffPercent: 0 }
  const a = PNG.sync.read(Buffer.from(base64A, 'base64'))
  const b = PNG.sync.read(Buffer.from(base64B, 'base64'))
  return compareImages(a, b, threshold)
}

export function isScreenshotDiffEnabled(): boolean {
  return process.env.SKIP_SCREENSHOT_DIFF !== '1'
}
