import { selectors } from './selectors'

type Rect = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }

export type TouchReadinessOptions = {
  /** Bound for each phase: the list wait, the probe drags, and the restore drags. */
  timeout?: number
  /** How long one drag may take to move the thumb before the gate drags again. */
  moveWindow?: number
  interval?: number
}

export type TouchReadiness = { drags: number; duration: number }

// The seekbar thumb rests at the end of its track after every launch.
// A left drag of PROBE_DISTANCE moves it; a right drag past that end restores it exactly.
const PROBE_DISTANCE = 40
const RESTORE_OVERSHOOT = 40
const MOVED = 1
const AT_REST = 0.5

async function rectOf(selector: string): Promise<Rect> {
  return driver.getElementRect(await $(selector).elementId)
}

function center({ x, y, width, height }: Rect): Point {
  return { x: x + width / 2, y: y + height / 2 }
}

function contains(rect: Rect, { x, y }: Point): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

// Drag the thumb itself. If the thumb lies outside its pan area (RTL layout puts it
// past the track end), drag the pan area: the pan moves the thumb by its translation.
async function dragStart(thumb: Rect): Promise<Point> {
  const track = await rectOf(selectors.seekbarTrack)
  const point = center(thumb)
  return contains(track, point) ? point : center(track)
}

async function drag(from: Point, dx: number, screenWidth: number): Promise<void> {
  const x = Math.round(from.x)
  const y = Math.round(from.y)
  const endX = Math.max(0, Math.min(screenWidth - 1, Math.round(from.x + dx)))
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: 300, origin: 'viewport', x: endX, y },
        { type: 'pointerUp', button: 0 }
      ]
    }
  ])
  await driver.releaseActions()
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeout: number,
  interval: number
): Promise<boolean> {
  return driver.waitUntil(condition, { timeout: Math.max(timeout, interval), interval }).then(
    () => true,
    () => false
  )
}

/**
 * Harness readiness gate, not a test retry: prove that synthetic touches reach the
 * live app before a spec sends its first gesture. On the list screen (the initial
 * route), drag the seekbar thumb and wait until its rect moves. A drag sent during a
 * simulator stall is lost, so drag again while the app stays on the list screen.
 * Then drag the thumb back to rest, because specs compare screenshots of that row.
 */
export async function waitForTouchReadiness(
  options: TouchReadinessOptions = {}
): Promise<TouchReadiness> {
  const { timeout = 30000, moveWindow = 5000, interval = 100 } = options
  const started = Date.now()
  // Each phase gets its own budget: a stall while the list appears must not
  // consume the time to move the thumb or to put it back.
  let phaseStart = started
  const startPhase = () => {
    phaseStart = Date.now()
  }
  const remaining = () => Math.max(0, phaseStart + timeout - Date.now())
  let drags = 0
  const failure = (reason: string) =>
    new Error(
      `Touch readiness gate failed after ${drags} drag(s) in ${Date.now() - started} ms: ${reason}`
    )
  const onListScreen = () => $(selectors.seekbarTrack).isDisplayed()

  if (!(await waitFor(onListScreen, remaining(), interval))) {
    throw failure('the list screen seekbar did not appear')
  }
  const { width } = await driver.getWindowSize()
  const rest = await rectOf(selectors.seekbarThumb)
  const moved = async () => Math.abs((await rectOf(selectors.seekbarThumb)).x - rest.x) > MOVED
  const atRest = async () => Math.abs((await rectOf(selectors.seekbarThumb)).x - rest.x) <= AT_REST

  startPhase()
  for (;;) {
    if (drags > 0 && remaining() === 0) {
      throw failure('the seekbar thumb never moved, so touches do not reach the app')
    }
    if (drags > 0 && !(await onListScreen())) {
      throw failure('the app left the list screen before a drag moved the seekbar thumb')
    }
    drags++
    await drag(await dragStart(await rectOf(selectors.seekbarThumb)), -PROBE_DISTANCE, width)
    if (await waitFor(moved, Math.min(moveWindow, remaining()), interval)) break
  }

  startPhase()
  for (;;) {
    const thumb = await rectOf(selectors.seekbarThumb)
    if (Math.abs(thumb.x - rest.x) <= AT_REST) break
    if (!(await onListScreen())) {
      throw failure('the app left the list screen before the seekbar thumb returned to rest')
    }
    if (remaining() === 0) throw failure('the seekbar thumb did not return to rest')
    drags++
    await drag(await dragStart(thumb), rest.x - thumb.x + RESTORE_OVERSHOOT, width)
    await waitFor(atRest, Math.min(moveWindow, remaining()), interval)
  }

  return { drags, duration: Date.now() - started }
}

/**
 * Relaunch the app. On iOS, also pass the touch readiness gate before the caller
 * sends a gesture. Android keeps its existing waits at each call site.
 */
export async function relaunchApp(appId: string): Promise<void> {
  await driver.terminateApp(appId)
  await driver.activateApp(appId)
  if (driver.isIOS) {
    const { drags, duration } = await waitForTouchReadiness()
    console.info(`Touch readiness after relaunch: ${drags} drag(s) in ${duration} ms`)
  }
}
