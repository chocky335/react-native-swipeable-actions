import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Classifies the CI host only. It never changes a shard or gate result.
const APP_SCENE = 'sceneID:com.swipeabledemo.app'
const LOG_FILE = 'simulator-log.txt'
const LOAD_FILE = 'host-load.txt'
const RESULTS = 'ios-results'
export const HEALTH_FILE = 'host-health.json'

/**
 * backboardd logs each XCTest touch sequence with the sender ID of its virtual digitizer.
 * A gesture that it routes to latent system gesture destinations for the app scene goes
 * to SpringBoard first. Under host overload, SpringBoard does not process it, and the app
 * never receives the touch.
 */
export function parseSimulatorLog(text) {
  const gestures = new Set()
  const latent = new Map()
  for (const line of text.split('\n')) {
    if (!line.includes('backboardd[') || !line.includes('BKDirectTouchState')) continue
    const sender = line.match(/senderID: (0x[0-9A-Fa-f]+)/)?.[1]
    if (!sender) continue
    gestures.add(sender)
    // The latent list is the last field of the state. An empty list prints as `()`.
    const field = line.indexOf('latentSystemGestureDestinations: (')
    if (field >= 0 && line.includes(APP_SCENE, field) && !latent.has(sender)) {
      latent.set(sender, line.slice(0, 23))
    }
  }
  return {
    gestures: gestures.size,
    latentRoutedGestures: latent.size,
    latentRoutedAt: [...latent.values()]
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

export function classify({ simulatorLog, hostLoad, results }) {
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
  // Host trouble explains a shard only when it explains each of its failures.
  let status = 'healthy'
  if (routing.gestures === 0) status = 'unknown'
  else if (results === undefined && routing.latentRoutedGestures > 0) status = 'unknown'
  else if (failures.length > 0 && failuresWithLatent === failures.length) status = 'trouble'
  else if (failuresWithLatent > 0) status = 'mixed'
  return {
    version: 2,
    status,
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

export async function report(directory, resultsDirectory) {
  const health = classify({
    simulatorLog: await optionalText(path.join(directory, LOG_FILE)),
    hostLoad: await optionalText(path.join(directory, LOAD_FILE)),
    results: await optionalResults(resultsDirectory)
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
  if (health.status === 'mixed')
    return `host mixed: ${health.failuresWithLatent} of ${health.failures} failures have latent-routed gestures (${gestures}), load ${load}`
  if (health.status === 'healthy') return `host healthy: ${gestures}`
  if (health.missing?.includes(LOG_FILE)) return 'host unknown: no simulator log'
  if (health.gestures > 0) return 'host unknown: no test results'
  return 'host unknown: no gestures in the simulator log'
}

function shardResult(receipt, maestro) {
  if (!receipt) return 'no receipt'
  const wdio = receipt.wdioOutcome || 'missing'
  const seekbar = receipt.maestroOutcome || 'missing'
  if (wdio === 'success' && seekbar === (maestro ? 'success' : 'skipped')) return 'passed'
  return maestro ? `failed (wdio ${wdio}, maestro ${seekbar})` : `failed (wdio ${wdio})`
}

const artifactPattern = /^ios-shard-[a-f0-9]{40}-\d+-\d+-(.+)$/

async function optionalJson(filename) {
  const text = await optionalText(filename)
  if (text === undefined) return
  try {
    return JSON.parse(text)
  } catch {
    return
  }
}

/** One row for each planned shard, in plan order, with its result and host class. */
export async function summarize(manifest, directory) {
  const roots = new Map()
  for (const name of await readdir(directory).catch(() => [])) {
    const id = name.match(artifactPattern)?.[1]
    if (id) roots.set(id, path.join(directory, name))
  }
  const rows = []
  for (const shard of manifest.shards) {
    const root = roots.get(shard.id)
    const receipt = root && (await optionalJson(path.join(root, 'ios-shard-receipt.json')))
    const health = root && (await optionalJson(path.join(root, 'ios-evidence', HEALTH_FILE)))
    rows.push({
      id: shard.id,
      result: root ? shardResult(receipt, shard.maestro) : 'no evidence',
      host: describeHealth(health),
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
  const cell = (value) => (value === null || value === undefined ? 'n/a' : String(value))
  return [
    '### iOS shard host health',
    '',
    'The host class does not change the gate result.',
    'Host trouble needs a latent-routed gesture inside the window of each failure.',
    '',
    '| Shard | Result | Host | Failures | Latent in failures | Latent total | Gestures | Max load | Min idle % |',
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
  if (command === 'report' && args.length === 2) {
    const health = await report(args[0], args[1])
    console.log(describeHealth(health))
  } else if (command === 'summary' && args.length === 2) {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'))
    const markdown = summaryMarkdown(await summarize(manifest, args[1]))
    console.log(markdown)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  } else {
    throw new Error(
      'Expected: report <evidence directory> <results directory> | summary <plan> <shard directory>'
    )
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
