// Synthetic attempt evidence for the gate and classifier tests. It is never release evidence.
import { classifyAttempt, READINESS_FAILURE } from '../host-health.mjs'

const pad = (value, width = 2) => String(value).padStart(width, '0')
const localDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const localTime = (date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

/** `top -l` output: one sample for each [time in ms, 1-minute load average], in local time. */
export function topSamples(samples) {
  return samples
    .map(([at, load]) => {
      const date = new Date(at)
      return [
        'Processes: 800 total, 80 running, 120 stuck, 600 sleeping, 3000 threads ',
        `${localDate(date).replaceAll('-', '/')} ${localTime(date)}`,
        `Load Avg: ${load}, ${load}, ${load} `,
        'CPU usage: 50.0% user, 50.0% sys, 0.0% idle '
      ].join('\n')
    })
    .join('\n')
    .concat('\n')
}

/** One `log show --style compact` line of a touch that reaches the app, in local time. */
export function touchLine(at) {
  const date = new Date(at)
  return (
    `${localDate(date)} ${localTime(date)}.${pad(date.getMilliseconds(), 3)} Df backboardd[5005:e726] ` +
    '[com.apple.BackBoard:TouchEvents] init: <BKDirectTouchState: 0x10d1b1b20; touchScreen; ' +
    'builtin; senderID: 0x1; contacts: []; destinations: [sceneID:com.swipeabledemo.app-default]; ' +
    'latentSystemGestureDestinations: ()>\n'
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
