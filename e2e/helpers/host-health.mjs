import assert from 'node:assert/strict'
import { appendFile, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  artifactName,
  loadAttempt,
  loadShardBundle,
  validateShard,
  validateShardEvidence
} from './ios-shards.mjs'

// Classifies the CI host. Host trouble never passes a case. It only permits the one retry
// of a shard that `retryReason` allows.
const APP_SCENE = 'sceneID:com.swipeabledemo.app'
const LOG_FILE = 'simulator-log.txt'
const LOAD_FILE = 'host-load.txt'
const RESULTS = 'ios-results'
const EVIDENCE = 'ios-evidence'
export const HEALTH_FILE = 'host-health.json'

/** The start of each error message of the touch readiness gate (`failure` in touch-readiness.ts). */
export const READINESS_FAILURE = 'Touch readiness gate failed'

/**
 * The reasons of the touch readiness gate that a stalled host explains: the gate waited for
 * the list screen or for a thumb move until its phase timed out. The other reasons are app
 * states (the app left the list screen, the thumb did not return to rest), so they stay real
 * failures.
 */
export const READINESS_TIMEOUTS = Object.freeze([
  'the list screen seekbar did not appear',
  'the seekbar thumb never moved, so touches do not reach the app'
])

/** True for the error message of a touch readiness timeout that host trouble can explain. */
export function isReadinessTimeout(message) {
  const reason = String(message).match(
    new RegExp(`^${READINESS_FAILURE} after \\d+ drag\\(s\\) in \\d+ ms: (.*)$`)
  )?.[1]
  return READINESS_TIMEOUTS.includes(reason)
}

/**
 * The 1-minute load average from which the host alone explains a touch readiness timeout.
 * The runner has 3 vCPUs, so at load L a runnable thread gets about 3/L of one CPU. A relaunch
 * that needs 1 CPU second on an idle host then needs about L/3 seconds, and from load 90 on it
 * misses the 30-second phase of the readiness gate. A host that keeps up has a load near 3.
 * The overload in the stored shard evidence of runs 39053954618, 39128353788 and 39273407706
 * never fell below 136 in 168 samples, in passed and in failed shards.
 */
export const HIGH_LOAD = 100

/**
 * backboardd logs each XCTest touch sequence with the sender ID of its virtual digitizer.
 * A gesture that it routes to latent system gesture destinations for the app scene goes
 * to SpringBoard first. Under host overload, SpringBoard does not process it, and the app
 * never receives the touch.
 *
 * The time of a gesture is its start: the first state line of its sender ID, `init:`.
 * The latent list shows only in later lines, such as `cancel` and `invalidate` at its end.
 */
export function parseSimulatorLog(text) {
  const started = new Map()
  const latent = new Set()
  for (const line of text.split('\n')) {
    if (!line.includes('backboardd[') || !line.includes('BKDirectTouchState')) continue
    const sender = line.match(/senderID: (0x[0-9A-Fa-f]+)/)?.[1]
    if (!sender) continue
    if (!started.has(sender)) started.set(sender, line.slice(0, 23))
    // The latent list is the last field of the state. An empty list prints as `()`.
    const field = line.indexOf('latentSystemGestureDestinations: (')
    if (field >= 0 && line.includes(APP_SCENE, field)) latent.add(sender)
  }
  return {
    gestures: started.size,
    latentRoutedGestures: latent.size,
    latentRoutedAt: [...latent].map((sender) => started.get(sender))
  }
}

/** Reads `top -l` samples. The first CPU sample of a run is not a delta, so it is not used. */
export function parseHostLoad(text) {
  const loads = [...text.matchAll(/^Load Avg: ([0-9.]+),/gm)].map((match) => Number(match[1]))
  const idle = [...text.matchAll(/^CPU usage: .*?([0-9.]+)% idle/gm)].map((match) =>
    Number(match[1])
  )
  const deltas = idle.length > 1 ? idle.slice(1) : idle
  return {
    loadSamples: loads.length,
    maxLoadAverage: loads.length > 0 ? Math.max(...loads) : null,
    minIdlePercent: deltas.length > 0 ? Math.min(...deltas) : null
  }
}

/**
 * Each `top -l` sample with its time and 1-minute load average. `top` prints a time without
 * a zone before the load. CI runs it with TZ=UTC, so the time is UTC in any zone of the
 * reader. A sample without a time has none.
 */
export function parseLoadSamples(text) {
  const samples = []
  let at = Number.NaN
  for (const line of text.split('\n')) {
    const time = line.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*$/)
    if (time) {
      const [year, month, day, hour, minute, second] = time.slice(1).map(Number)
      at = Date.UTC(year, month - 1, day, hour, minute, second)
      continue
    }
    const load = line.match(/^Load Avg: ([0-9.]+),/)
    if (load) {
      samples.push({ at, load: Number(load[1]) })
      at = Number.NaN
    }
  }
  return samples
}

async function optionalText(filename) {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
}

/**
 * `log show --style compact` prints a time without a zone. CI runs it with `--timezone UTC`,
 * so the time is UTC. The gate classifies again on another host, so the zone of the reader
 * must not apply.
 */
export function logTime(stamp) {
  const parts = stamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
  if (!parts) return NaN
  const [year, month, day, hour, minute, second, ms] = parts.slice(1).map(Number)
  return Date.UTC(year, month - 1, day, hour, minute, second, ms)
}

/** Reads the NDJSON worker results. A truncated or invalid line is ignored. */
export function parseResults(text) {
  const records = []
  for (const line of text.split('\n')) {
    try {
      const record = JSON.parse(line)
      if (record && typeof record === 'object' && typeof record.event === 'string') {
        records.push(record)
      }
    } catch {
      // Ignored: a lost test-result leaves its test unfinished, which is a failure.
    }
  }
  return records
}

/** True for a hook that times out in the touch readiness gate, for example in a relaunch. */
const readinessFailure = (record) =>
  record.event === 'hook-failure' &&
  typeof record.error?.message === 'string' &&
  isReadinessTimeout(record.error.message)

/**
 * One [start, end] window for each failure in the order of the records: a failed test,
 * a failed hook and a failed warm-up. A test without its result fails. Its window ends
 * at the next record. Without a next record, the window has no end and no gesture.
 * The window of a touch readiness hook failure has `readinessTimeout: true`.
 */
export function failureWindows(records) {
  const windows = []
  let open
  let previous
  const time = (record) => Date.parse(record.timestamp)
  const close = (end) => {
    if (open)
      windows.push({
        title: open.fullTitle ?? open.title,
        start: time(open),
        end
      })
    open = undefined
  }
  for (const record of records) {
    if (record.event === 'test-start') {
      close(time(record))
      open = record
    } else if (record.event === 'test-result') {
      const start = open ? time(open) : previous && time(previous)
      open = undefined
      if (record.status === 'failed') {
        windows.push({
          title: record.fullTitle ?? record.title,
          start,
          end: time(record)
        })
      }
    } else if (record.event === 'hook-failure' || (record.event === 'warm-up' && !record.ok)) {
      const start = open ? time(open) : previous && time(previous)
      const title = open ? (open.fullTitle ?? open.title) : (record.hook ?? record.event)
      open = undefined
      windows.push({
        title,
        start,
        end: time(record),
        ...(readinessFailure(record) && { readinessTimeout: true })
      })
    } else if (record.event === 'worker-end') {
      close(time(record))
    } else if (record.event === 'worker-start') {
      close(undefined)
    }
    previous = record
  }
  close(undefined)
  return windows
}

/** True for a failed case: its result says failed, and it is not pending or skipped. */
const failedCase = (record) =>
  record.event === 'test-result' && record.status === 'failed' && !record.pending && !record.skipped

/** True for a failure that host trouble can explain: a failed case or a readiness hook failure. */
const explainable = (record) => failedCase(record) || readinessFailure(record)

/**
 * True when the quarantine of the worker-end record starts in the runnable of this record:
 * a case or a hook. Its runnable is the Mocha full title: the titles of the suites, then the
 * title of the case or hook.
 */
function quarantinedIn(quarantine, record) {
  const runnable = quarantine?.runnable
  if (typeof runnable !== 'string') return false
  if (!record.parent) return runnable === record.title
  const own = `${record.parent} ${record.title}`
  return runnable === own || runnable.endsWith(` ${own}`)
}

/**
 * True when the explainable failures alone cause the worker result. WDIO gives `after` the
 * Mocha failure count: one for each failed case and for each failed hook. A hook that fails
 * in its body has a hook record. A session quarantine fails each later hook before the WDIO
 * hook wrapper runs, so these hooks have no record (command-scope.ts `wrap`). A larger
 * count is part of the failures only when the worker ends directly after the last failure,
 * and its worker-end record shows a quarantine that starts in that failure.
 */
function failuresCauseResult(records) {
  const end = records.at(-1)
  if (end?.event !== 'worker-end' || !Number.isInteger(end.result)) return false
  const failed = records.filter(explainable).length
  if (failed === 0) return false
  if (end.result === failed) return true
  const last = records.at(-2)
  return end.result > failed && explainable(last ?? {}) && quarantinedIn(end.quarantine, last)
}

/**
 * Passed records for each case that never started, when a touch readiness hook failure ends
 * the worker. Mocha starts no later case of the suite after a failed hook. The cases that
 * started must be the first cases of the plan, in its order: Mocha runs the cases of these
 * specs in plan order. A gap, such as from a grep filter, is not part of the timeout. Any
 * other case that did not start, or that started and did not finish, stays a gate rejection.
 */
function unstartedCasesPassed(shard, records) {
  const hook = records.at(-2)
  if (records.at(-1)?.event !== 'worker-end' || !readinessFailure(hook ?? {})) return []
  const key = (record) => JSON.stringify([record.parent, record.title])
  const started = records.filter((record) => record.event === 'test-start').map(key)
  const first = shard.cases.slice(0, started.length).map(key)
  if (started.some((entry, index) => entry !== first[index])) return []
  const { pid, worker } = records[0] ?? {}
  return shard.cases.slice(started.length).flatMap((entry) => {
    const metadata = { timestamp: hook.timestamp, pid, worker, ...entry, file: hook.file }
    return [
      { ...metadata, event: 'test-start', attempt: 0 },
      {
        ...metadata,
        event: 'test-result',
        attempt: 0,
        status: 'passed',
        duration: 0,
        retries: { attempts: 0, limit: 0 }
      }
    ]
  })
}

/**
 * The same evidence with each explainable failure passed, and with the step and worker
 * outcomes that it causes. A failed case passes. A touch readiness hook failure goes, and
 * when it ends the worker, each case that never started passes. CI runs the Maestro step
 * only after a successful WDIO step, so a failed WDIO step skips it. Nothing else changes.
 */
function withFailedCasesPassed(shard, { receipt, workers }) {
  const wdioFailed = receipt.wdioOutcome === 'failure'
  const maestroSkipped = shard.maestro && wdioFailed && receipt.maestroOutcome === 'skipped'
  return {
    receipt: {
      ...receipt,
      ...(wdioFailed && { wdioOutcome: 'success' }),
      ...(maestroSkipped && { maestroOutcome: 'success' })
    },
    workers: workers.map((records) => {
      const causedResult = failuresCauseResult(records)
      const unstarted = unstartedCasesPassed(shard, records)
      return records.flatMap((record) => {
        if (failedCase(record)) return [{ ...record, status: 'passed', error: null }]
        if (readinessFailure(record)) return []
        if (record.event === 'worker-end')
          return [...unstarted, causedResult ? { ...record, result: 0 } : record]
        return [record]
      })
    })
  }
}

/**
 * The gate checks for one attempt. `failedCases` counts the failed cases and the touch
 * readiness hook failures. `onlyFailedCases` is true only when the gate rejects the attempt
 * for these failures and for nothing else. Only then can host trouble explain it.
 */
export function gateCheck(shard, bundle, context) {
  try {
    return { passed: validateShard(shard, bundle, context), failedCases: 0, onlyFailedCases: false }
  } catch (error) {
    const failedCases = bundle.workers.flat().filter(explainable).length
    let onlyFailedCases = false
    if (failedCases > 0) {
      try {
        validateShard(shard, withFailedCasesPassed(shard, bundle), context)
        onlyFailedCases = true
      } catch {
        // Another gate check fails too, so the shard has a failure that is not a failed case.
      }
    }
    return { error, failedCases, onlyFailedCases }
  }
}

/** True when each load sample in the window is at least HIGH_LOAD, and it has a sample. */
const highLoad = (failure) => failure.minLoadAverage !== null && failure.minLoadAverage >= HIGH_LOAD

/**
 * `gate` is the result of `gateCheck` for the shard. Without it, the shard is never host
 * trouble. A failed case needs a latent-routed gesture in its window. A touch readiness
 * timeout needs high load in its window instead: at least one `top` sample, and each sample
 * at HIGH_LOAD or more. Latent-routed gestures in the window of a timeout do not count, and
 * a timeout needs no simulator log.
 */
export function classify({ simulatorLog, hostLoad, results, gate }) {
  const missing = []
  if (simulatorLog === undefined) missing.push(LOG_FILE)
  if (hostLoad === undefined) missing.push(LOAD_FILE)
  if (results === undefined) missing.push(RESULTS)
  const routing =
    simulatorLog === undefined
      ? { gestures: 0, latentRoutedGestures: 0, latentRoutedAt: [] }
      : parseSimulatorLog(simulatorLog)
  const load =
    hostLoad === undefined
      ? { loadSamples: 0, maxLoadAverage: null, minIdlePercent: null }
      : parseHostLoad(hostLoad)
  const samples = hostLoad === undefined ? [] : parseLoadSamples(hostLoad)
  const latent = routing.latentRoutedAt.map(logTime)
  const inside = (window, at) => at >= window.start && at <= window.end
  const failures = (results === undefined ? [] : failureWindows(parseResults(results))).map(
    (window) => {
      const failure = {
        ...window,
        latentRoutedGestures: latent.filter((at) => inside(window, at)).length
      }
      if (!window.readinessTimeout) return failure
      const loads = samples.filter(({ at }) => inside(window, at)).map((sample) => sample.load)
      return {
        ...failure,
        loadSamples: loads.length,
        minLoadAverage: loads.length > 0 ? Math.min(...loads) : null
      }
    }
  )
  // Only the windows of failed cases use gestures.
  const cases = failures.filter((failure) => !failure.readinessTimeout)
  const failuresWithLatent = cases.filter((window) => window.latentRoutedGestures > 0).length
  const failuresExplained = failures.filter((failure) =>
    failure.readinessTimeout ? highLoad(failure) : failure.latentRoutedGestures > 0
  ).length
  // Host trouble explains a shard only when the gate rejects it for these failures alone,
  // and host trouble explains each of them.
  const onlyFailedCases = gate?.onlyFailedCases === true && gate.failedCases === failures.length
  // Without gestures, only readiness timeouts can be classified: they use load samples.
  const needsGestures = failures.length === 0 || cases.length > 0
  let status = 'healthy'
  if (routing.gestures === 0 && needsGestures) status = 'unknown'
  else if (results === undefined && routing.latentRoutedGestures > 0) status = 'unknown'
  else if (onlyFailedCases && failures.length > 0 && failuresExplained === failures.length)
    status = 'trouble'
  else if (failuresExplained > 0) status = 'mixed'
  const time = (at) => (Number.isFinite(at) ? new Date(at).toISOString() : null)
  return {
    version: 4,
    status,
    onlyFailedCases,
    ...routing,
    latentRoutedInFailures: latent.filter((at) => cases.some((w) => inside(w, at))).length,
    failures: failures.length,
    failuresWithLatent,
    failuresExplained,
    failedTests: failures.map(({ title, start, end, latentRoutedGestures }) => ({
      title,
      start: time(start),
      end: time(end),
      latentRoutedGestures
    })),
    readinessTimeouts: failures
      .filter((failure) => failure.readinessTimeout)
      .map((failure) => ({
        title: failure.title,
        start: time(failure.start),
        end: time(failure.end),
        loadSamples: failure.loadSamples,
        minLoadAverage: failure.minLoadAverage,
        highLoad: highLoad(failure)
      })),
    ...load,
    missing
  }
}

/** The host class of one attempt from its raw evidence, the way the gate derives it again. */
export function classifyAttempt(shard, attempt, context) {
  const records = attempt.workers.flat()
  return classify({
    simulatorLog: attempt.simulatorLog,
    hostLoad: attempt.hostLoad,
    results:
      records.length > 0
        ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
        : undefined,
    gate: gateCheck(shard, attempt, context)
  })
}

/**
 * The reason for the one retry of a shard after this attempt. It throws when the attempt
 * cannot have a retry. The attempt must be attempt 1, its WDIO step must fail, and its
 * Maestro step must not run. The classifier must find host trouble in its raw evidence,
 * and its own host-health.json must say host trouble too. The WDIO step of CI and the gate
 * both use this check.
 */
export function retryReason(shard, attempt, context) {
  assert.equal(attempt.receipt?.attempt, 1, 'Only attempt 1 can have a retry')
  assert.equal(attempt.receipt.wdioOutcome, 'failure', 'A retry needs a failed WDIO step')
  assert.equal(attempt.receipt.maestroOutcome, 'skipped', 'A Maestro step never gets a retry')
  assert.equal(attempt.health?.status, 'trouble', 'A retry needs host trouble in host-health.json')
  const health = classifyAttempt(shard, attempt, context)
  assert.equal(health.status, 'trouble', `A retry needs host trouble: ${describeHealth(health)}`)
  return describeHealth(health)
}

async function optionalResults(directory) {
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  const files = names.filter((name) => name.endsWith('.ndjson')).sort()
  if (files.length === 0) return
  const texts = await Promise.all(files.map((name) => readFile(path.join(directory, name), 'utf8')))
  return texts.join('\n')
}

/** The gate checks for one attempt directory. Evidence that the gate cannot read has none. */
async function optionalGateCheck(manifest, shard, root) {
  try {
    return gateCheck(shard, await loadAttempt(root), manifest)
  } catch {
    return
  }
}

/** Writes host-health.json for one attempt directory: its receipt, results and evidence. */
export async function report(manifest, id, root) {
  const shard = manifest.shards.find((entry) => entry.id === id)
  const directory = path.join(root, EVIDENCE)
  const health = classify({
    simulatorLog: await optionalText(path.join(directory, LOG_FILE)),
    hostLoad: await optionalText(path.join(directory, LOAD_FILE)),
    results: await optionalResults(path.join(root, RESULTS)),
    gate: shard && (await optionalGateCheck(manifest, shard, root))
  })
  await writeFile(path.join(directory, HEALTH_FILE), `${JSON.stringify(health, null, 2)}\n`)
  return health
}

export function describeHealth(health) {
  if (!health) return 'host unknown: no host-health.json'
  const load = health.maxLoadAverage ?? 'n/a'
  const timeouts = health.readinessTimeouts ?? []
  const causes =
    timeouts.length > 0
      ? `latent-routed gestures or a touch readiness timeout at load ${HIGH_LOAD} or more`
      : 'latent-routed gestures'
  const highLoads = timeouts.filter((timeout) => timeout.highLoad).length
  const gestures =
    `${health.latentRoutedInFailures} of ${health.latentRoutedGestures} latent-routed gestures in failures` +
    (timeouts.length > 0
      ? `, ${highLoads} of ${timeouts.length} touch readiness timeouts at load ${HIGH_LOAD} or more`
      : '')
  if (health.status === 'trouble')
    return `host trouble: all ${health.failures} failures have ${causes} (${gestures}), load ${load}`
  if (health.status === 'mixed') {
    const other = health.onlyFailedCases ? '' : ', other gate checks fail too'
    // Version 3 has no failuresExplained. Its failures with latent gestures are the explained ones.
    const explained = health.failuresExplained ?? health.failuresWithLatent
    return `host mixed: ${explained} of ${health.failures} failures have ${causes}${other} (${gestures}), load ${load}`
  }
  if (health.status === 'healthy') return `host healthy: ${gestures}`
  if (health.missing?.includes(LOG_FILE)) return 'host unknown: no simulator log'
  if (health.gestures > 0) return 'host unknown: no test results'
  return 'host unknown: no gestures in the simulator log'
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0]
const skippedCase = (record) => record.status === 'skipped' || record.pending || record.skipped
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The same evidence with each condition that `failedConditions` names passed. */
function withConditionsPassed(shard, { receipt, workers }) {
  const maestroOutcome = shard.maestro ? 'success' : 'skipped'
  return {
    receipt: { ...receipt, wdioOutcome: 'success', maestroOutcome },
    workers: workers.map((records) =>
      records
        .filter((record) => record.event !== 'hook-failure' && record.event !== 'hook-skipped')
        .map((record, index) => {
          if (record.event === 'warm-up' && index === 1) return { ...record, ok: true }
          if (record.event === 'test-result')
            return { ...record, status: 'passed', error: null, pending: false, skipped: false }
          if (record.event === 'worker-end') return { ...record, result: 0 }
          return record
        })
    )
  }
}

/**
 * Every gate condition that one shard fails: the step outcomes, the warm-up, the cases, the
 * hooks, the inventory and the worker. The first message of any other gate check comes last.
 */
function failedConditions(shard, bundle, context) {
  const { receipt } = bundle
  const records = bundle.workers.flat()
  const conditions = []
  if (receipt.wdioOutcome !== 'success') conditions.push(`wdio ${receipt.wdioOutcome ?? 'missing'}`)
  const maestro = shard.maestro ? 'success' : 'skipped'
  if (receipt.maestroOutcome !== maestro)
    conditions.push(`maestro ${receipt.maestroOutcome ?? 'missing'} (expected ${maestro})`)
  if (records[1]?.event === 'warm-up' && records[1].ok !== true) conditions.push('warm-up failed')
  const results = records.filter((record) => record.event === 'test-result')
  const skipped = results.filter(skippedCase).length
  const failed = results.filter(
    (record) => !skippedCase(record) && (record.status !== 'passed' || record.error != null)
  ).length
  if (failed > 0) conditions.push(count(failed, 'failed case'))
  if (skipped > 0) conditions.push(count(skipped, 'skipped or pending case'))
  const hooks = records.filter(
    (record) => record.event === 'hook-failure' || record.event === 'hook-skipped'
  ).length
  if (hooks > 0) conditions.push(count(hooks, 'failed or skipped hook'))
  const key = (record) => JSON.stringify([record.parent, record.title])
  const expected = new Set(shard.cases.map(key))
  const finished = new Set(results.map(key).filter((entry) => expected.has(entry)))
  if (finished.size < expected.size)
    conditions.push(`${finished.size} of ${expected.size} cases finished`)
  const end = records.at(-1)
  if (end?.event === 'worker-end' && end.result !== 0)
    conditions.push(`worker result ${end.result}`)
  try {
    validateShard(shard, withConditionsPassed(shard, bundle), context)
  } catch (error) {
    conditions.push(firstLine(error))
  }
  return conditions
}

/** The gate's own checks for one attempt. The gate also needs the plan, the build and every shard. */
async function shardResult(manifest, shard, root) {
  let bundle
  try {
    bundle = await loadAttempt(root)
  } catch (error) {
    if (error?.code === 'ENOENT')
      return { result: `rejected: missing ${path.relative(root, error.path)}` }
    return { result: `rejected: ${firstLine(error)}` }
  }
  const check = gateCheck(shard, bundle, manifest)
  if (check.passed !== undefined) return { result: `passed (${check.passed} cases)`, check }
  const conditions = failedConditions(shard, bundle, manifest)
  // The list is never empty for a rejected shard. The gate message is the fallback.
  if (conditions.length === 0) conditions.push(firstLine(check.error))
  return { result: `rejected: ${conditions.join(', ')}`, check }
}

/** The summary repeats the gate checks. Host trouble needs them to reject failed cases only. */
function checkedHealth(health, check) {
  if (health?.status !== 'trouble') return health
  if (check?.onlyFailedCases && check.failedCases === health.failures) return health
  return { ...health, status: 'mixed', onlyFailedCases: false }
}

async function optionalJson(filename) {
  const text = await optionalText(filename)
  if (text === undefined) return
  try {
    return JSON.parse(text)
  } catch {
    return
  }
}

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** The attempt directories of one shard artifact, in order: attempt-1, attempt-2 and so on. */
async function attemptDirectories(root) {
  const number = (name) => Number(name.slice('attempt-'.length))
  return (await readdir(root))
    .filter((name) => /^attempt-[1-9][0-9]*$/.test(name))
    .sort((a, b) => number(a) - number(b))
}

/** The first gate message for the shard and all its attempts, or nothing when the gate accepts it. */
async function shardRejection(manifest, shard, root) {
  try {
    validateShardEvidence(shard, await loadShardBundle(root), manifest)
  } catch (error) {
    return firstLine(error)
  }
}

function summaryRow(id, result, health, check) {
  return {
    id,
    result,
    host: describeHealth(checkedHealth(health, check)),
    failures: health?.failures ?? null,
    latentRoutedInFailures: health?.latentRoutedInFailures ?? null,
    latentRoutedGestures: health?.latentRoutedGestures ?? null,
    gestures: health?.gestures ?? null,
    maxLoadAverage: health?.maxLoadAverage ?? null,
    minIdlePercent: health?.minIdlePercent ?? null
  }
}

/**
 * One row for each attempt of each planned shard, in plan order, with its gate checks and host
 * class. The last row of a shard with a retry also says whether the gate accepts the retry.
 */
export async function summarize(manifest, directory) {
  const rows = []
  for (const shard of manifest.shards) {
    const root = path.join(directory, artifactName(manifest, shard.id))
    if (!(await exists(root))) {
      rows.push(summaryRow(shard.id, 'no evidence'))
      continue
    }
    const attempts = await attemptDirectories(root)
    if (attempts.length === 0) {
      rows.push(summaryRow(shard.id, 'rejected: missing attempt-1'))
      continue
    }
    for (const [index, name] of attempts.entries()) {
      const attemptRoot = path.join(root, name)
      const health = await optionalJson(path.join(attemptRoot, EVIDENCE, HEALTH_FILE))
      const { result, check } = await shardResult(manifest, shard, attemptRoot)
      const id = attempts.length > 1 ? `${shard.id} (attempt ${index + 1})` : shard.id
      rows.push(summaryRow(id, result, health, check))
    }
    const last = rows.at(-1)
    const rejection = await shardRejection(manifest, shard, root)
    if (attempts.length > 1)
      last.result += rejection ? `; retry rejected: ${rejection}` : '; retry accepted'
    else if (rejection && last.result.startsWith('passed')) last.result = `rejected: ${rejection}`
  }
  return rows
}

export function summaryMarkdown(rows) {
  const cell = (value) =>
    value === null || value === undefined
      ? 'n/a'
      : String(value).replaceAll('\n', ' ').replaceAll('|', '\\|')
  return [
    '### iOS shard host health',
    '',
    'Host trouble never passes a case. It only permits one retry of a shard.',
    "Gate checks runs the gate's checks for one shard. The gate also needs the plan, the build and every shard.",
    'Host trouble needs failed cases and touch readiness hook timeouts as the only gate rejections.',
    `Each failed case needs a latent-routed gesture in its window. Each timeout needs load ${HIGH_LOAD} or more in its window.`,
    'A shard with a retry has one row for each attempt. Its last row says whether the gate accepts the retry.',
    '',
    '| Shard | Gate checks | Host | Failures | Latent in failures | Latent total | Gestures | Max load | Min idle % |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        '| ' +
        [
          row.id,
          row.result,
          row.host,
          row.failures,
          row.latentRoutedInFailures,
          row.latentRoutedGestures,
          row.gestures,
          row.maxLoadAverage,
          row.minIdlePercent
        ]
          .map(cell)
          .join(' | ') +
        ' |'
    ),
    ''
  ].join('\n')
}

async function main([command, ...args]) {
  if (command === 'report' && args.length === 3) {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'))
    const health = await report(manifest, args[1], args[2])
    console.log(describeHealth(health))
  } else if (command === 'retry' && args.length === 3) {
    // Writes host-health.json like `report`. Exit code 0 permits the one retry of the shard.
    const [planFile, id, root] = args
    const manifest = JSON.parse(await readFile(planFile, 'utf8'))
    console.log(describeHealth(await report(manifest, id, root)))
    try {
      const shard = manifest.shards.find((entry) => entry.id === id)
      assert.ok(shard, 'Unknown shard')
      console.log(`Retry: ${retryReason(shard, await loadAttempt(root, true), manifest)}`)
    } catch (error) {
      console.log(`No retry: ${firstLine(error)}`)
      process.exitCode = 1
    }
  } else if (command === 'summary' && args.length === 2) {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'))
    const markdown = summaryMarkdown(await summarize(manifest, args[1]))
    console.log(markdown)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  } else {
    throw new Error(
      'Expected: report <plan> <shard ID> <attempt directory> | retry <plan> <shard ID> <attempt directory> | summary <plan> <shard directory>'
    )
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
