import { appendFile, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { artifactName, loadShardBundle, validateShard } from './ios-shards.mjs'

// Classifies the CI host only. It never changes a shard or gate result.
const APP_SCENE = 'sceneID:com.swipeabledemo.app'
const LOG_FILE = 'simulator-log.txt'
const LOAD_FILE = 'host-load.txt'
const RESULTS = 'ios-results'
const EVIDENCE = 'ios-evidence'
export const HEALTH_FILE = 'host-health.json'

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

async function optionalText(filename) {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
}

/**
 * `log show --style compact` prints the local time of the shard host without a zone.
 * The report step runs on the same host, so the local zone of this process applies.
 */
export function logTime(stamp) {
  const parts = stamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
  if (!parts) return NaN
  const [year, month, day, hour, minute, second, ms] = parts.slice(1).map(Number)
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime()
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

/**
 * One [start, end] window for each failure in the order of the records: a failed test,
 * a failed hook and a failed warm-up. A test without its result fails. Its window ends
 * at the next record. Without a next record, the window has no end and no gesture.
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
      windows.push({ title, start, end: time(record) })
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

/**
 * The same evidence with each failed case passed, and with the WDIO step and the worker
 * outcomes that a failed case causes. Nothing else changes.
 */
function withFailedCasesPassed({ receipt, workers }) {
  return {
    receipt: receipt.wdioOutcome === 'failure' ? { ...receipt, wdioOutcome: 'success' } : receipt,
    workers: workers.map((records) =>
      records.map((record) => {
        if (failedCase(record)) return { ...record, status: 'passed', error: null }
        if (record.event === 'worker-end' && record.result === 1) return { ...record, result: 0 }
        return record
      })
    )
  }
}

/**
 * The gate checks for one shard. `onlyFailedCases` is true only when the gate rejects the
 * shard for its failed cases and for nothing else. Only then can host trouble explain it.
 */
export function gateCheck(shard, bundle, context) {
  try {
    return { passed: validateShard(shard, bundle, context), failedCases: 0, onlyFailedCases: false }
  } catch (error) {
    const failedCases = bundle.workers.flat().filter(failedCase).length
    let onlyFailedCases = false
    if (failedCases > 0) {
      try {
        validateShard(shard, withFailedCasesPassed(bundle), context)
        onlyFailedCases = true
      } catch {
        // Another gate check fails too, so the shard has a failure that is not a failed case.
      }
    }
    return { error, failedCases, onlyFailedCases }
  }
}

/**
 * `gate` is the result of `gateCheck` for the shard. Without it, the shard is never host
 * trouble.
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
  const latent = routing.latentRoutedAt.map(logTime)
  const inside = (window, at) => at >= window.start && at <= window.end
  const failures = (results === undefined ? [] : failureWindows(parseResults(results))).map(
    (window) => ({
      ...window,
      latentRoutedGestures: latent.filter((at) => inside(window, at)).length
    })
  )
  const failuresWithLatent = failures.filter((window) => window.latentRoutedGestures > 0).length
  // Host trouble explains a shard only when the gate rejects it for failed cases alone, and
  // each failed case has a latent-routed gesture.
  const onlyFailedCases = gate?.onlyFailedCases === true && gate.failedCases === failures.length
  let status = 'healthy'
  if (routing.gestures === 0) status = 'unknown'
  else if (results === undefined && routing.latentRoutedGestures > 0) status = 'unknown'
  else if (onlyFailedCases && failures.length > 0 && failuresWithLatent === failures.length)
    status = 'trouble'
  else if (failuresWithLatent > 0) status = 'mixed'
  return {
    version: 3,
    status,
    onlyFailedCases,
    ...routing,
    latentRoutedInFailures: latent.filter((at) => failures.some((w) => inside(w, at))).length,
    failures: failures.length,
    failuresWithLatent,
    failedTests: failures.map(({ title, start, end, latentRoutedGestures }) => ({
      title,
      start: Number.isFinite(start) ? new Date(start).toISOString() : null,
      end: Number.isFinite(end) ? new Date(end).toISOString() : null,
      latentRoutedGestures
    })),
    ...load,
    missing
  }
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

/** The gate checks for one shard artifact. Evidence that the gate cannot read has none. */
async function optionalGateCheck(manifest, shard, root) {
  try {
    return gateCheck(shard, await loadShardBundle(root), manifest)
  } catch {
    return
  }
}

/** Writes host-health.json for one shard artifact: its receipt, results and evidence. */
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
  const gestures = `${health.latentRoutedInFailures} of ${health.latentRoutedGestures} latent-routed gestures in failures`
  if (health.status === 'trouble')
    return `host trouble: all ${health.failures} failures have latent-routed gestures (${gestures}), load ${load}`
  if (health.status === 'mixed') {
    const other = health.onlyFailedCases ? '' : ', other gate checks fail too'
    return `host mixed: ${health.failuresWithLatent} of ${health.failures} failures have latent-routed gestures${other} (${gestures}), load ${load}`
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

/** The gate's own checks for one shard. The gate also needs the plan, the build and every shard. */
async function shardResult(manifest, shard, root) {
  let bundle
  try {
    bundle = await loadShardBundle(root)
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

/** One row for each planned shard, in plan order, with its gate checks and host class. */
export async function summarize(manifest, directory) {
  const rows = []
  for (const shard of manifest.shards) {
    const root = path.join(directory, artifactName(manifest, shard.id))
    const found = await exists(root)
    const health = found ? await optionalJson(path.join(root, EVIDENCE, HEALTH_FILE)) : undefined
    const { result, check } = found ? await shardResult(manifest, shard, root) : {}
    rows.push({
      id: shard.id,
      result: result ?? 'no evidence',
      host: describeHealth(checkedHealth(health, check)),
      failures: health?.failures ?? null,
      latentRoutedInFailures: health?.latentRoutedInFailures ?? null,
      latentRoutedGestures: health?.latentRoutedGestures ?? null,
      gestures: health?.gestures ?? null,
      maxLoadAverage: health?.maxLoadAverage ?? null,
      minIdlePercent: health?.minIdlePercent ?? null
    })
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
    'The host class does not change the gate result.',
    "Gate checks runs the gate's checks for one shard. The gate also needs the plan, the build and every shard.",
    'Host trouble needs failed cases as the only gate rejections, each with a latent-routed gesture inside its window.',
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
  } else if (command === 'summary' && args.length === 2) {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'))
    const markdown = summaryMarkdown(await summarize(manifest, args[1]))
    console.log(markdown)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  } else {
    throw new Error(
      'Expected: report <plan> <shard ID> <shard artifact directory> | summary <plan> <shard directory>'
    )
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
