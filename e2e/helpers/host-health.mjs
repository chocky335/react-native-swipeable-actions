import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Classifies the CI host only. It never changes a shard or gate result.
const APP_SCENE = 'sceneID:com.swipeabledemo.app'
const LOG_FILE = 'simulator-log.txt'
const LOAD_FILE = 'host-load.txt'
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

export function classify({ simulatorLog, hostLoad }) {
  const missing = []
  if (simulatorLog === undefined) missing.push(LOG_FILE)
  if (hostLoad === undefined) missing.push(LOAD_FILE)
  const routing =
    simulatorLog === undefined
      ? { gestures: 0, latentRoutedGestures: 0, latentRoutedAt: [] }
      : parseSimulatorLog(simulatorLog)
  const load =
    hostLoad === undefined
      ? { loadSamples: 0, maxLoadAverage: null, minIdlePercent: null }
      : parseHostLoad(hostLoad)
  let status = 'healthy'
  if (routing.latentRoutedGestures > 0) status = 'trouble'
  else if (routing.gestures === 0) status = 'unknown'
  return { version: 1, status, ...routing, ...load, missing }
}

export async function report(directory) {
  const health = classify({
    simulatorLog: await optionalText(path.join(directory, LOG_FILE)),
    hostLoad: await optionalText(path.join(directory, LOAD_FILE))
  })
  await writeFile(path.join(directory, HEALTH_FILE), `${JSON.stringify(health, null, 2)}\n`)
  return health
}

export function describeHealth(health) {
  if (!health) return 'host unknown: no host-health.json'
  const load = health.maxLoadAverage ?? 'n/a'
  if (health.status === 'trouble')
    return `host trouble: ${health.latentRoutedGestures} latent-routed gestures, load ${load}`
  if (health.status === 'healthy') return 'host healthy'
  if (health.missing?.includes(LOG_FILE)) return 'host unknown: no simulator log'
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
    '',
    '| Shard | Result | Host | Gestures | Max load | Min idle % |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        '| ' +
        [row.id, row.result, row.host, row.gestures, row.maxLoadAverage, row.minIdlePercent]
          .map(cell)
          .join(' | ') +
        ' |'
    ),
    ''
  ].join('\n')
}

async function main([command, ...args]) {
  if (command === 'report' && args.length === 1) {
    const health = await report(args[0])
    console.log(describeHealth(health))
  } else if (command === 'summary' && args.length === 2) {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'))
    const markdown = summaryMarkdown(await summarize(manifest, args[1]))
    console.log(markdown)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  } else {
    throw new Error('Expected: report <evidence directory> | summary <plan> <shard directory>')
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
