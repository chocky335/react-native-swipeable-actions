import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  classify,
  describeHealth,
  failureWindows,
  HEALTH_FILE,
  logTime,
  parseHostLoad,
  parseResults,
  parseSimulatorLog,
  report,
  summarize,
  summaryMarkdown
} from './host-health.mjs'

// The CI host runs in UTC. `log show` prints its local time without a zone.
process.env.TZ = 'UTC'

// Trimmed from the CI shard evidence of run 39053954618 (swipeable).
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'host-health')
// One latent-routed gesture during the warm-up, at 18:04:07.338.
const simulatorLog = await readFile(path.join(fixtures, 'simulator-log.txt'), 'utf8')
// One latent-routed gesture inside the failed first test, at 18:04:57.133.
const failedTestLog = await readFile(path.join(fixtures, 'simulator-log-failed-test.txt'), 'utf8')
const hostLoad = await readFile(path.join(fixtures, 'host-load.txt'), 'utf8')
// Warm-up until 18:04:45.375, a failed test from 18:04:45.394 to 18:05:08.788, then
// a passed test from 18:05:45.434 to 18:06:20.282.
const results = await readFile(path.join(fixtures, 'ios-results.ndjson'), 'utf8')
const twoFailures = results.replace('"status":"passed"', '"status":"failed"')

function ndjson(...records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n'
}

async function temporary(body) {
  const directory = await mkdtemp(path.join(tmpdir(), 'host-health-'))
  try {
    return await body(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('one latent-routed and one healthy gesture per sender ID', () => {
  assert.deepEqual(parseSimulatorLog(simulatorLog), {
    gestures: 2,
    latentRoutedGestures: 1,
    latentRoutedAt: ['2026-10-17 18:04:07.338']
  })
})

test('a latent destination for another scene is not app trouble', () => {
  const other = simulatorLog.replaceAll(
    'sceneID:com.swipeabledemo.app-default',
    'sceneID:com.apple.springboard'
  )
  assert.equal(parseSimulatorLog(other).latentRoutedGestures, 0)
  assert.equal(parseSimulatorLog(other).gestures, 2)
})

test('the scene name outside the latent list is not app trouble', () => {
  const line =
    '2026-10-17 18:04:28.744 Df backboardd[5005:e726] [com.apple.BackBoard:TouchEvents] ' +
    'invalidate: <BKDirectTouchState: 0x10d1b1b20; touchScreen; builtin; senderID: 0x1; ' +
    'contacts: contacts: []; destinations: [sceneID:com.swipeabledemo.app-default]; ' +
    'latentSystemGestureDestinations: ()>'
  assert.deepEqual(parseSimulatorLog(line), {
    gestures: 1,
    latentRoutedGestures: 0,
    latentRoutedAt: []
  })
})

test('max load uses every sample, min idle skips the first top sample', () => {
  assert.deepEqual(parseHostLoad(hostLoad), {
    loadSamples: 3,
    maxLoadAverage: 512.16,
    minIdlePercent: 0.4
  })
  assert.deepEqual(parseHostLoad(hostLoad.split('Processes:').slice(0, 2).join('Processes:')), {
    loadSamples: 1,
    maxLoadAverage: 512.16,
    minIdlePercent: 0
  })
  assert.deepEqual(parseHostLoad(''), {
    loadSamples: 0,
    maxLoadAverage: null,
    minIdlePercent: null
  })
})

test('the compact log time is the local time of the host', () => {
  assert.equal(logTime('2026-10-17 18:04:07.338'), Date.parse('2026-10-17T18:04:07.338Z'))
  process.env.TZ = 'Asia/Tokyo'
  try {
    assert.equal(logTime('2026-10-17 18:04:07.338'), Date.parse('2026-10-17T09:04:07.338Z'))
  } finally {
    process.env.TZ = 'UTC'
  }
  assert.ok(Number.isNaN(logTime('Timestamp               Ty')))
})

test('a latent-routed gesture only during the warm-up does not explain a failure', () => {
  const health = classify({ simulatorLog, hostLoad, results })
  assert.equal(health.status, 'healthy')
  assert.equal(health.latentRoutedGestures, 1)
  assert.equal(health.latentRoutedInFailures, 0)
  assert.equal(health.failures, 1)
  assert.equal(health.failuresWithLatent, 0)
  assert.deepEqual(health.failedTests, [
    {
      title: 'should open and close swipeable row',
      start: '2026-10-17T18:04:45.394Z',
      end: '2026-10-17T18:05:08.788Z',
      latentRoutedGestures: 0
    }
  ])
  assert.equal(describeHealth(health), 'host healthy: 0 of 1 latent-routed gestures in failures')
})

test('a latent-routed gesture inside the failed test window is host trouble', () => {
  const health = classify({
    simulatorLog: simulatorLog + failedTestLog,
    hostLoad,
    results
  })
  assert.equal(health.status, 'trouble')
  assert.equal(health.latentRoutedGestures, 2)
  assert.equal(health.latentRoutedInFailures, 1)
  assert.equal(health.failuresWithLatent, 1)
  assert.equal(
    describeHealth(health),
    'host trouble: all 1 failures have latent-routed gestures ' +
      '(1 of 2 latent-routed gestures in failures), load 512.16'
  )
})

test('two failures with latent-routed gestures in only one are not host trouble', () => {
  const health = classify({
    simulatorLog: simulatorLog + failedTestLog,
    hostLoad,
    results: twoFailures
  })
  assert.equal(health.status, 'mixed')
  assert.equal(health.failures, 2)
  assert.equal(health.failuresWithLatent, 1)
  assert.deepEqual(
    health.failedTests.map((failure) => failure.latentRoutedGestures),
    [1, 0]
  )
  assert.equal(
    describeHealth(health),
    'host mixed: 1 of 2 failures have latent-routed gestures ' +
      '(1 of 2 latent-routed gestures in failures), load 512.16'
  )
})

test('without a failure, latent-routed gestures are healthy', () => {
  const passed = results.replace('"status":"failed"', '"status":"passed"')
  const health = classify({
    simulatorLog: simulatorLog + failedTestLog,
    hostLoad,
    results: passed
  })
  assert.equal(health.status, 'healthy')
  assert.equal(health.failures, 0)
  assert.equal(describeHealth(health), 'host healthy: 0 of 2 latent-routed gestures in failures')
})

test('failure windows: unfinished tests, hooks and a failed warm-up', () => {
  const at = (second) => `2026-10-17T18:00:${String(second).padStart(2, '0')}.000Z`
  const time = (second) => Date.parse(at(second))
  const windows = failureWindows(
    parseResults(
      ndjson(
        { timestamp: at(0), event: 'worker-start' },
        { timestamp: at(5), event: 'warm-up', ok: false },
        { timestamp: at(10), event: 'test-start', title: 'lost result' },
        { timestamp: at(20), event: 'test-start', title: 'hook' },
        { timestamp: at(25), event: 'hook-failure', hook: 'beforeEach' },
        { timestamp: at(30), event: 'hook-failure', hook: 'after all' },
        { timestamp: at(40), event: 'test-start', title: 'skipped' },
        {
          timestamp: at(45),
          event: 'test-result',
          title: 'skipped',
          status: 'skipped'
        },
        { timestamp: at(50), event: 'test-start', title: 'last' }
      ) + '{"timestamp":"2026-10-17T18:00:55.000Z","event":"test-res'
    )
  )
  assert.deepEqual(windows, [
    { title: 'warm-up', start: time(0), end: time(5) },
    { title: 'lost result', start: time(10), end: time(20) },
    { title: 'hook', start: time(20), end: time(25) },
    { title: 'after all', start: time(25), end: time(30) },
    { title: 'last', start: time(50), end: undefined }
  ])
})

test('a failure without an end never counts as host trouble', () => {
  const unfinished = results.split('\n').slice(0, 3).join('\n') + '\n'
  const health = classify({
    simulatorLog: simulatorLog + failedTestLog,
    hostLoad,
    results: unfinished
  })
  assert.equal(health.failures, 1)
  assert.equal(health.failedTests[0].end, null)
  assert.equal(health.status, 'healthy')
})

test('classification without the inputs it needs is unknown', () => {
  const noResults = classify({ simulatorLog, hostLoad, results: undefined })
  assert.equal(noResults.status, 'unknown')
  assert.deepEqual(noResults.missing, ['ios-results'])
  assert.equal(describeHealth(noResults), 'host unknown: no test results')
  const healthyLog = simulatorLog.replaceAll('sceneID:com.swipeabledemo.app', 'sceneID:other')
  const healthy = classify({
    simulatorLog: healthyLog,
    hostLoad: undefined,
    results: undefined
  })
  assert.equal(healthy.status, 'healthy')
  assert.deepEqual(healthy.missing, ['host-load.txt', 'ios-results'])
  const noLog = classify({ simulatorLog: undefined, hostLoad, results })
  assert.equal(noLog.status, 'unknown')
  assert.equal(describeHealth(noLog), 'host unknown: no simulator log')
  const noGestures = classify({
    simulatorLog: 'Timestamp Ty Process[PID:TID]\n',
    hostLoad,
    results
  })
  assert.equal(describeHealth(noGestures), 'host unknown: no gestures in the simulator log')
  assert.equal(describeHealth(undefined), 'host unknown: no host-health.json')
  assert.equal(
    describeHealth(
      classify({
        simulatorLog: simulatorLog + failedTestLog,
        hostLoad: undefined,
        results
      })
    ),
    'host trouble: all 1 failures have latent-routed gestures ' +
      '(1 of 2 latent-routed gestures in failures), load n/a'
  )
})

test('report writes host-health.json next to the evidence, even without inputs', async () => {
  await temporary(async (directory) => {
    const evidence = path.join(directory, 'ios-evidence')
    const resultsDirectory = path.join(directory, 'ios-results')
    await mkdir(evidence)
    await mkdir(resultsDirectory)
    await writeFile(path.join(evidence, 'simulator-log.txt'), simulatorLog + failedTestLog)
    await copyFile(path.join(fixtures, 'host-load.txt'), path.join(evidence, 'host-load.txt'))
    await copyFile(
      path.join(fixtures, 'ios-results.ndjson'),
      path.join(resultsDirectory, 'worker-14696-1792260093215.ndjson')
    )
    const health = await report(evidence, resultsDirectory)
    assert.deepEqual(JSON.parse(await readFile(path.join(evidence, HEALTH_FILE), 'utf8')), health)
    assert.deepEqual(health, {
      version: 2,
      status: 'trouble',
      gestures: 3,
      latentRoutedGestures: 2,
      latentRoutedAt: ['2026-10-17 18:04:07.338', '2026-10-17 18:04:57.133'],
      latentRoutedInFailures: 1,
      failures: 1,
      failuresWithLatent: 1,
      failedTests: [
        {
          title: 'should open and close swipeable row',
          start: '2026-10-17T18:04:45.394Z',
          end: '2026-10-17T18:05:08.788Z',
          latentRoutedGestures: 1
        }
      ],
      loadSamples: 3,
      maxLoadAverage: 512.16,
      minIdlePercent: 0.4,
      missing: []
    })
  })
  await temporary(async (directory) => {
    const health = await report(directory, path.join(directory, 'ios-results'))
    assert.equal(health.status, 'unknown')
    assert.deepEqual(health.missing, ['simulator-log.txt', 'host-load.txt', 'ios-results'])
  })
})

test('summary lists every planned shard with its result and host class', async () => {
  await temporary(async (directory) => {
    const prefix = `ios-shard-${'a'.repeat(40)}-123-1-`
    async function shard(id, receipt, health) {
      const root = path.join(directory, prefix + id)
      await mkdir(path.join(root, 'ios-evidence'), { recursive: true })
      if (receipt)
        await writeFile(path.join(root, 'ios-shard-receipt.json'), JSON.stringify(receipt))
      if (health)
        await writeFile(path.join(root, 'ios-evidence', HEALTH_FILE), JSON.stringify(health))
    }
    const healthy = classify({
      simulatorLog: simulatorLog.replaceAll('sceneID:com.swipeabledemo.app', 'sceneID:other'),
      hostLoad,
      results
    })
    await shard(
      'swipeable',
      { wdioOutcome: 'failure', maestroOutcome: 'skipped' },
      classify({
        simulatorLog: simulatorLog + failedTestLog,
        hostLoad,
        results
      })
    )
    await shard('swipe-back', { wdioOutcome: 'success', maestroOutcome: 'skipped' }, healthy)
    await shard('rtl', undefined, undefined)
    const manifest = {
      shards: [
        { id: 'performance', maestro: false },
        { id: 'rtl', maestro: false },
        { id: 'swipe-back', maestro: false },
        { id: 'swipeable', maestro: true }
      ]
    }
    const rows = await summarize(manifest, directory)
    assert.deepEqual(
      rows.map(({ id, result, host }) => ({ id, result, host })),
      [
        {
          id: 'performance',
          result: 'no evidence',
          host: 'host unknown: no host-health.json'
        },
        {
          id: 'rtl',
          result: 'no receipt',
          host: 'host unknown: no host-health.json'
        },
        {
          id: 'swipe-back',
          result: 'passed',
          host: 'host healthy: 0 of 0 latent-routed gestures in failures'
        },
        {
          id: 'swipeable',
          result: 'failed (wdio failure, maestro skipped)',
          host:
            'host trouble: all 1 failures have latent-routed gestures ' +
            '(1 of 2 latent-routed gestures in failures), load 512.16'
        }
      ]
    )
    const markdown = summaryMarkdown(rows)
    assert.match(
      markdown,
      /^\| swipeable \| failed \(wdio failure, maestro skipped\) \| host trouble: .*, load 512\.16 \| 1 \| 1 \| 2 \| 3 \| 512\.16 \| 0\.4 \|$/m
    )
    assert.match(
      markdown,
      /^\| performance \| no evidence \| .* \| n\/a \| n\/a \| n\/a \| n\/a \| n\/a \| n\/a \|$/m
    )
  })
})

test('a passed Maestro shard needs both outcomes', async () => {
  await temporary(async (directory) => {
    const root = path.join(directory, `ios-shard-${'b'.repeat(40)}-9-2-swipeable`)
    await mkdir(root)
    await writeFile(
      path.join(root, 'ios-shard-receipt.json'),
      JSON.stringify({ wdioOutcome: 'success', maestroOutcome: 'failure' })
    )
    const [row] = await summarize({ shards: [{ id: 'swipeable', maestro: true }] }, directory)
    assert.equal(row.result, 'failed (wdio success, maestro failure)')
  })
})
