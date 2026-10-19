// Synthetic attempt evidence for the gate and classifier tests. It is never release evidence.
import { classifyAttempt, READINESS_FAILURE } from '../host-health.mjs'

const pad = (value, width = 2) => String(value).padStart(width, '0')
// CI prints each evidence time in UTC: `TZ=UTC top` and `log show --timezone UTC`.
const utcDate = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
const utcTime = (date) =>
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`

/** `top -l -n 0` output: one sample for each [time in ms, 1-minute load average], in UTC. */
export function topSamples(samples) {
  return samples
    .map(([at, load]) => {
      const date = new Date(at)
      return [
        'Processes: 800 total, 80 running, 120 stuck, 600 sleeping, 3000 threads ',
        `${utcDate(date).replaceAll('-', '/')} ${utcTime(date)}`,
        `Load Avg: ${load}, ${load}, ${load} `,
        'CPU usage: 50.0% user, 50.0% sys, 0.0% idle '
      ].join('\n')
    })
    .join('\n')
    .concat('\n')
}

/**
 * One `log show --style compact` line of a touch, in UTC. A touch reaches the app. A latent
 * touch goes to the latent system gesture destinations of the app scene first.
 */
export function touchLine(at, latent = false) {
  const date = new Date(at)
  const destinations = latent ? 'sceneID:com.swipeabledemo.app-default' : ''
  return (
    `${utcDate(date)} ${utcTime(date)}.${pad(date.getUTCMilliseconds(), 3)} Df backboardd[5005:e726] ` +
    '[com.apple.BackBoard:TouchEvents] init: <BKDirectTouchState: 0x10d1b1b20; touchScreen; ' +
    `builtin; senderID: ${latent ? '0x2' : '0x1'}; contacts: []; ` +
    `destinations: [sceneID:com.swipeabledemo.app-default]; latentSystemGestureDestinations: (${destinations})>\n`
  )
}

/**
 * Attempt 1 of a shard that ends like the swipeable shard of run 39273407706: the first case
 * passes, then its afterEach relaunch times out in the touch readiness gate. The worker
 * quarantines the session in that hook and ends. Mocha starts no later case. `load` is the
 * 1-minute load average of each `top` sample inside the hook window.
 */
export function readinessTimeoutAttempt(shard, context, { start, load, file, pid = 41 }) {
  const at = (seconds) => new Date(start + seconds * 1000).toISOString()
  const common = { pid, worker: '0-0' }
  const [first] = shard.cases
  const hook = { parent: 'suite', title: `"after each" hook: wrappedHook for "${first.title}"` }
  const runnable = `${hook.parent} ${hook.title}`
  const metadata = { ...common, ...first, file, attempt: 0 }
  const attempt = {
    receipt: {
      version: 1,
      sha: context.sha,
      runId: context.runId,
      runAttempt: context.runAttempt,
      id: shard.id,
      spec: shard.spec,
      sourceHash: shard.sourceHash,
      attempt: 1,
      retryReason: null,
      wdioOutcome: 'failure',
      maestroOutcome: 'skipped'
    },
    workers: [
      [
        { ...common, timestamp: at(0), event: 'worker-start', specs: [file] },
        { ...common, timestamp: at(60), event: 'warm-up', ok: true, drags: 2, duration: 57274 },
        { ...metadata, timestamp: at(61), event: 'test-start' },
        {
          ...metadata,
          timestamp: at(90),
          event: 'test-result',
          status: 'passed',
          duration: 29000,
          retries: { attempts: 0, limit: 0 }
        },
        {
          ...common,
          ...hook,
          timestamp: at(127),
          event: 'hook-failure',
          hook: 'afterEach',
          file,
          duration: 36899,
          error: {
            name: 'Error',
            message: `${READINESS_FAILURE} after 0 drag(s) in 30128 ms: the list screen seekbar did not appear`
          }
        },
        {
          ...common,
          timestamp: at(127.1),
          event: 'worker-end',
          result: 2,
          specs: [file],
          quarantine: { reason: `unresolved request when "${runnable}" ended`, runnable }
        }
      ]
    ],
    simulatorLog: touchLine(start + 70000),
    hostLoad: topSamples([95, 105, 115, 125].map((second) => [start + second * 1000, load]))
  }
  attempt.health = classifyAttempt(shard, attempt, context)
  return attempt
}
