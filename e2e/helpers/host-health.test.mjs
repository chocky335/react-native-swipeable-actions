import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readinessTimeoutAttempt, topSamples } from './fixtures/host-trouble.mjs'
import {
  classify,
  classifyAttempt,
  describeHealth,
  failureWindows,
  gateCheck,
  HEALTH_FILE,
  HIGH_LOAD,
  logTime,
  parseHostLoad,
  parseLoadSamples,
  parseResults,
  parseSimulatorLog,
  report,
  retryReason,
  summarize,
  summaryMarkdown
} from './host-health.mjs'
import {
  artifactName,
  buildManifest,
  EXPECTED_COUNTS,
  parseRecords,
  validateAggregate
} from './ios-shards.mjs'

// The CI host runs in UTC. `log show` prints its local time without a zone.
process.env.TZ = 'UTC'

// Trimmed from the CI shard evidence of run 39053954618 (swipeable).
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'host-health')
// One latent-routed gesture during the warm-up. It starts at 18:04:07.304 and ends at 18:04:07.338.
const simulatorLog = await readFile(path.join(fixtures, 'simulator-log.txt'), 'utf8')
// One latent-routed gesture inside the failed first test. It starts at 18:04:56.618 and ends
// at 18:04:57.133.
const failedTestLog = await readFile(path.join(fixtures, 'simulator-log-failed-test.txt'), 'utf8')
const hostLoad = await readFile(path.join(fixtures, 'host-load.txt'), 'utf8')
// Warm-up until 18:04:45.375, a failed test from 18:04:45.394 to 18:05:08.788, then
// a passed test from 18:05:45.434 to 18:06:20.282.
const results = await readFile(path.join(fixtures, 'ios-results.ndjson'), 'utf8')
const twoFailures = results.replace('"status":"passed"', '"status":"failed"')
// The gate rejects the shard for its failed cases alone.
const onlyFailedCases = (failedCases) => ({ onlyFailedCases: true, failedCases })

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
    latentRoutedAt: ['2026-10-17 18:04:07.304']
  })
})

test('a latent-routed gesture has the time of its first state line, not of its end', () => {
  assert.deepEqual(parseSimulatorLog(failedTestLog), {
    gestures: 1,
    latentRoutedGestures: 1,
    latentRoutedAt: ['2026-10-17 18:04:56.618']
  })
})

test('a latent-routed gesture that starts before a failure window and ends in it does not count', () => {
  // The gesture starts after the warm-up and before the failed test, and it ends in the test.
  const early = failedTestLog.replace('2026-10-17 18:04:56.618', '2026-10-17 18:04:45.380')
  const health = classify({
    simulatorLog: simulatorLog + early,
    hostLoad,
    results,
    gate: onlyFailedCases(1)
  })
  assert.deepEqual(health.latentRoutedAt, ['2026-10-17 18:04:07.304', '2026-10-17 18:04:45.380'])
  assert.equal(health.latentRoutedInFailures, 0)
  assert.equal(health.failuresWithLatent, 0)
  assert.equal(health.status, 'healthy')
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
    results,
    gate: onlyFailedCases(1)
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
    results: twoFailures,
    gate: onlyFailedCases(2)
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
        results,
        gate: onlyFailedCases(1)
      })
    ),
    'host trouble: all 1 failures have latent-routed gestures ' +
      '(1 of 2 latent-routed gestures in failures), load n/a'
  )
})

test('without the gate checks, a shard is never host trouble', () => {
  const health = classify({ simulatorLog: simulatorLog + failedTestLog, hostLoad, results })
  assert.equal(health.status, 'mixed')
  assert.equal(health.onlyFailedCases, false)
  assert.equal(
    describeHealth(health),
    'host mixed: 1 of 1 failures have latent-routed gestures, other gate checks fail too ' +
      '(1 of 2 latent-routed gestures in failures), load 512.16'
  )
  const wrongCount = classify({
    simulatorLog: simulatorLog + failedTestLog,
    hostLoad,
    results,
    gate: onlyFailedCases(2)
  })
  assert.equal(wrongCount.status, 'mixed')
})

const context = { sha: 'a'.repeat(40), runId: '123', runAttempt: '1' }
const manifest = buildManifest(
  Object.fromEntries(
    Object.entries(EXPECTED_COUNTS).map(([spec, count]) => [
      spec,
      `describe("suite", () => { for (let i = 0; i < ${count}; i++) it("case " + i, () => {}) })`
    ])
  ),
  context
)

/** Evidence that passes the gate checks for one shard. */
function passingBundle(shard) {
  const common = { timestamp: '2026-10-17T18:00:00.000Z', pid: 42, worker: '0-0' }
  const spec = `/checkout/e2e/${shard.spec}`
  const records = [
    { ...common, event: 'worker-start', specs: [`file://${spec}`] },
    { ...common, event: 'warm-up', ok: true }
  ]
  for (const entry of shard.cases) {
    const metadata = { ...common, ...entry, file: spec, attempt: 0 }
    records.push({ ...metadata, event: 'test-start' })
    records.push({
      ...metadata,
      event: 'test-result',
      status: 'passed',
      duration: 10,
      retries: { attempts: 0, limit: 0 }
    })
  }
  records.push({ ...common, event: 'worker-end', specs: [`file://${spec}`], result: 0 })
  return {
    receipt: {
      version: 1,
      ...context,
      id: shard.id,
      spec: shard.spec,
      sourceHash: shard.sourceHash,
      attempt: 1,
      retryReason: null,
      wdioOutcome: 'success',
      maestroOutcome: shard.maestro ? 'success' : 'skipped'
    },
    workers: [records]
  }
}

/** Writes one attempt directory of a shard artifact, and its evidence files. */
async function writeShard(directory, shard, bundle, health, attempt = 1) {
  const { receipt, workers, simulatorLog, hostLoad } = bundle ?? {}
  const root = path.join(directory, artifactName(context, shard.id), `attempt-${attempt}`)
  await mkdir(path.join(root, 'ios-evidence'), { recursive: true })
  if (receipt) await writeFile(path.join(root, 'ios-shard-receipt.json'), JSON.stringify(receipt))
  if (workers) {
    await mkdir(path.join(root, 'ios-results'))
    await writeFile(path.join(root, 'ios-results', 'worker-42-1.ndjson'), ndjson(...workers[0]))
  }
  if (health) await writeFile(path.join(root, 'ios-evidence', HEALTH_FILE), JSON.stringify(health))
  if (simulatorLog)
    await writeFile(path.join(root, 'ios-evidence', 'simulator-log.txt'), simulatorLog)
  if (hostLoad) await writeFile(path.join(root, 'ios-evidence', 'host-load.txt'), hostLoad)
}

const shardById = (id) => manifest.shards.find((shard) => shard.id === id)

/**
 * Swipeable evidence that the gate rejects for one failed case only. The case fails in
 * the window of the failed test in the fixtures.
 */
function failingBundle() {
  const bundle = passingBundle(shardById('swipeable'))
  const records = bundle.workers[0]
  for (const record of records) record.timestamp = '2026-10-17T18:06:00.000Z'
  records[0].timestamp = '2026-10-17T18:04:03.523Z'
  records[1].timestamp = '2026-10-17T18:04:45.375Z'
  records[2].timestamp = '2026-10-17T18:04:45.394Z'
  Object.assign(records[3], {
    timestamp: '2026-10-17T18:05:08.788Z',
    status: 'failed',
    error: { name: 'Error', message: 'row did not open' }
  })
  records.at(-1).result = 1
  bundle.receipt.wdioOutcome = 'failure'
  return bundle
}

function classifyBundle(bundle) {
  return classify({
    simulatorLog: simulatorLog + failedTestLog,
    hostLoad,
    results: ndjson(...bundle.workers[0]),
    gate: gateCheck(shardById('swipeable'), bundle, context)
  })
}

test('failed cases as the only gate rejections, each with a latent gesture, are host trouble', () => {
  const bundle = failingBundle()
  assert.deepEqual(
    { ...gateCheck(shardById('swipeable'), bundle, context), error: undefined },
    { error: undefined, failedCases: 1, onlyFailedCases: true }
  )
  const health = classifyBundle(bundle)
  assert.equal(health.status, 'trouble')
  assert.equal(health.onlyFailedCases, true)
  assert.equal(health.failuresWithLatent, 1)
})

// Each of these makes the gate reject the shard for more than its failed case.
const otherRejections = {
  'Maestro failure': (bundle) => {
    bundle.receipt.maestroOutcome = 'failure'
  },
  'skipped case': (bundle) => {
    bundle.workers[0][5].status = 'skipped'
  },
  'pending case': (bundle) => {
    bundle.workers[0][5].pending = true
  },
  'passed case with an error': (bundle) => {
    bundle.workers[0][5].error = { name: 'Error' }
  },
  'failed warm-up': (bundle) => {
    bundle.workers[0][1].ok = false
  },
  'hook failure': (bundle) => {
    bundle.workers[0].splice(4, 0, {
      ...bundle.workers[0][3],
      event: 'hook-failure',
      hook: 'afterEach'
    })
  },
  'missing case': (bundle) => {
    bundle.workers[0].splice(4, 2)
  },
  'unfinished worker': (bundle) => {
    bundle.workers[0].pop()
  },
  'worker result 2': (bundle) => {
    bundle.workers[0].at(-1).result = 2
  },
  'cancelled WDIO step': (bundle) => {
    bundle.receipt.wdioOutcome = 'cancelled'
  },
  'stale receipt': (bundle) => {
    bundle.receipt.runAttempt = '2'
  }
}

for (const [reason, mutate] of Object.entries(otherRejections)) {
  test(`a latent-routed failed case with another gate rejection is not host trouble: ${reason}`, () => {
    const bundle = failingBundle()
    mutate(bundle)
    const check = gateCheck(shardById('swipeable'), bundle, context)
    assert.equal(check.passed, undefined)
    assert.equal(check.onlyFailedCases, false)
    const health = classifyBundle(bundle)
    assert.notEqual(health.status, 'trouble')
    assert.doesNotMatch(describeHealth(health), /^host trouble/)
  })
}

// Trimmed from the CI shard evidence of run 39128353788 (performance and swipeable). Each
// shard has one failed case with one latent-routed gesture in its window. The performance
// session was quarantined in its only case, and its worker result is 3. The failed WDIO
// step of the swipeable shard skipped its Maestro step. Each worker-end record has the
// `quarantine` field as the worker now writes it. The job log of the run gives its value.
const run = path.join(fixtures, 'run-39128353788')
const runContext = {
  sha: '7de18da9088e798b57ce60f2dd284dfc4d74cfd0',
  runId: '39128353788',
  runAttempt: '1'
}
const runEvidence = {}
for (const id of ['performance', 'swipeable']) {
  runEvidence[id] = {
    receipt: JSON.parse(await readFile(path.join(run, `${id}-receipt.json`), 'utf8')),
    results: await readFile(path.join(run, `${id}-results.ndjson`), 'utf8'),
    simulatorLog: await readFile(path.join(run, `${id}-simulator-log.txt`), 'utf8')
  }
}

/** A registration source with the cases of the run evidence. */
function registeredCases(results) {
  return parseRecords(results)
    .filter((record) => record.event === 'test-start')
    .map(
      ({ parent, title }) =>
        `describe(${JSON.stringify(parent)}, () => { it(${JSON.stringify(title)}, () => {}) })`
    )
    .join('\n')
}

const runManifest = buildManifest(
  Object.fromEntries(
    Object.entries(EXPECTED_COUNTS).map(([spec, count]) => {
      const id = path.basename(spec, '.spec.ts')
      if (runEvidence[id]) return [spec, registeredCases(runEvidence[id].results)]
      return [
        spec,
        `describe("suite", () => { for (let i = 0; i < ${count}; i++) it("case " + i, () => {}) })`
      ]
    })
  ),
  runContext
)
const runShard = (id) => runManifest.shards.find((shard) => shard.id === id)

/** The run evidence of one shard. The plan of this test has its own source hash. */
function runBundle(id) {
  const { receipt, results } = runEvidence[id]
  return {
    receipt: { ...receipt, sourceHash: runShard(id).sourceHash },
    workers: [parseRecords(results)]
  }
}

function classifyRun(id, bundle) {
  return classify({
    simulatorLog: runEvidence[id].simulatorLog,
    hostLoad,
    results: ndjson(...bundle.workers[0]),
    gate: gateCheck(runShard(id), bundle, runContext)
  })
}

const caseTitle =
  'Benchmark 0: run-benchmark produces a result string should run benchmark and surface FPS result'

test('run 39128353788: a quarantine that starts in the last failed case is part of that case', () => {
  const bundle = runBundle('performance')
  assert.equal(bundle.workers[0].at(-1).result, 3)
  assert.equal(
    bundle.workers[0].at(-1).quarantine.runnable,
    `Swipeable Performance Tests ${caseTitle}`
  )
  assert.equal(bundle.receipt.wdioOutcome, 'failure')
  assert.deepEqual(
    { ...gateCheck(runShard('performance'), bundle, runContext), error: undefined },
    { error: undefined, failedCases: 1, onlyFailedCases: true }
  )
  const health = classifyRun('performance', bundle)
  assert.equal(health.status, 'trouble')
  assert.equal(health.failures, 1)
  assert.equal(health.failuresWithLatent, 1)
  assert.match(describeHealth(health), /^host trouble/)
})

test('run 39128353788: a Maestro step skipped after a failed WDIO step is part of the failed case', () => {
  const bundle = runBundle('swipeable')
  assert.equal(bundle.workers[0].at(-1).result, 1)
  assert.deepEqual(
    [bundle.receipt.wdioOutcome, bundle.receipt.maestroOutcome],
    ['failure', 'skipped']
  )
  assert.deepEqual(
    { ...gateCheck(runShard('swipeable'), bundle, runContext), error: undefined },
    { error: undefined, failedCases: 1, onlyFailedCases: true }
  )
  const health = classifyRun('swipeable', bundle)
  assert.equal(health.status, 'trouble')
  assert.equal(health.failures, 1)
  assert.equal(health.failuresWithLatent, 1)
})

// Each of these is a rejection that the failed case of the run does not cause.
const runRejections = {
  'Maestro failure': [
    'swipeable',
    (bundle) => {
      bundle.receipt.maestroOutcome = 'failure'
    }
  ],
  'Maestro cancelled': [
    'swipeable',
    (bundle) => {
      bundle.receipt.maestroOutcome = 'cancelled'
    }
  ],
  'Maestro skipped after a successful WDIO step': [
    'swipeable',
    (bundle) => {
      bundle.receipt.wdioOutcome = 'success'
    }
  ],
  'worker result 3 after a passed last case': [
    'swipeable',
    (bundle) => {
      bundle.workers[0].at(-1).result = 3
    }
  ],
  'worker result 2 for one failed case': [
    'swipeable',
    (bundle) => {
      bundle.workers[0].at(-1).result = 2
    }
  ],
  'worker result 1 for two failed cases': [
    'swipeable',
    (bundle) => {
      Object.assign(bundle.workers[0][5], { status: 'failed', error: { name: 'Error' } })
    }
  ],
  'worker result that is not a count': [
    'performance',
    (bundle) => {
      bundle.workers[0].at(-1).result = { message: 'spec load error' }
    }
  ],
  'worker result 3 without a quarantine field': [
    'performance',
    (bundle) => {
      delete bundle.workers[0].at(-1).quarantine
    }
  ],
  'worker result 3 without a quarantine': [
    'performance',
    (bundle) => {
      bundle.workers[0].at(-1).quarantine = null
    }
  ],
  'quarantine without an owning runnable': [
    'performance',
    (bundle) => {
      bundle.workers[0].at(-1).quarantine = {
        reason: 'a new runnable began with unresolved requests',
        runnable: null
      }
    }
  ],
  'quarantine that starts in another runnable': [
    'performance',
    (bundle) => {
      const runnable =
        'Swipeable Performance Tests "after each" hook for "should run benchmark and surface FPS result"'
      bundle.workers[0].at(-1).quarantine = {
        reason: `unresolved request when "${runnable}" ended`,
        runnable
      }
    }
  ],
  'quarantine with a hook record': [
    'performance',
    (bundle) => {
      bundle.workers[0].splice(4, 0, {
        ...bundle.workers[0][3],
        event: 'hook-failure',
        hook: 'afterEach'
      })
    }
  ]
}

for (const [reason, [id, mutate]] of Object.entries(runRejections)) {
  test(`run 39128353788: a latent-routed failed case with another rejection is mixed: ${reason}`, () => {
    const bundle = runBundle(id)
    mutate(bundle)
    const check = gateCheck(runShard(id), bundle, runContext)
    assert.equal(check.passed, undefined)
    assert.equal(check.onlyFailedCases, false)
    const health = classifyRun(id, bundle)
    assert.equal(health.status, 'mixed')
    assert.match(describeHealth(health), /^host mixed: .*, other gate checks fail too/)
  })
}

test('the worker result of the failed cases alone is one Mocha failure for each case', () => {
  const bundle = runBundle('swipeable')
  Object.assign(bundle.workers[0][5], { status: 'failed', error: { name: 'Error' } })
  bundle.workers[0].at(-1).result = 2
  assert.deepEqual(
    { ...gateCheck(runShard('swipeable'), bundle, runContext), error: undefined },
    { error: undefined, failedCases: 2, onlyFailedCases: true }
  )
})

test('the gate checks pass a passing shard, and it has no failed cases', () => {
  const check = gateCheck(shardById('swipeable'), passingBundle(shardById('swipeable')), context)
  assert.deepEqual(check, { passed: 25, failedCases: 0, onlyFailedCases: false })
})

test('report writes host-health.json next to the evidence, even without inputs', async () => {
  await temporary(async (directory) => {
    const shard = shardById('swipeable')
    await writeShard(directory, shard, failingBundle())
    const root = path.join(directory, artifactName(context, shard.id), 'attempt-1')
    const evidence = path.join(root, 'ios-evidence')
    await writeFile(path.join(evidence, 'simulator-log.txt'), simulatorLog + failedTestLog)
    await copyFile(path.join(fixtures, 'host-load.txt'), path.join(evidence, 'host-load.txt'))
    const health = await report(manifest, shard.id, root)
    assert.deepEqual(JSON.parse(await readFile(path.join(evidence, HEALTH_FILE), 'utf8')), health)
    assert.deepEqual(health, {
      version: 4,
      status: 'trouble',
      onlyFailedCases: true,
      gestures: 3,
      latentRoutedGestures: 2,
      latentRoutedAt: ['2026-10-17 18:04:07.304', '2026-10-17 18:04:56.618'],
      latentRoutedInFailures: 1,
      failures: 1,
      failuresWithLatent: 1,
      failuresExplained: 1,
      failedTests: [
        {
          title: 'suite case 0',
          start: '2026-10-17T18:04:45.394Z',
          end: '2026-10-17T18:05:08.788Z',
          latentRoutedGestures: 1
        }
      ],
      readinessTimeouts: [],
      loadSamples: 3,
      maxLoadAverage: 512.16,
      minIdlePercent: 0.4,
      missing: []
    })
  })
  await temporary(async (directory) => {
    await mkdir(path.join(directory, 'ios-evidence'))
    const health = await report(manifest, 'swipeable', directory)
    assert.equal(health.status, 'unknown')
    assert.equal(health.onlyFailedCases, false)
    assert.deepEqual(health.missing, ['simulator-log.txt', 'host-load.txt', 'ios-results'])
  })
})

test('summary lists every planned shard with its gate checks and host class', async () => {
  await temporary(async (directory) => {
    const healthy = classify({
      simulatorLog: simulatorLog.replaceAll('sceneID:com.swipeabledemo.app', 'sceneID:other'),
      hostLoad,
      results
    })
    const failed = failingBundle()
    await writeShard(directory, shardById('swipeable'), failed, classifyBundle(failed))
    await writeShard(
      directory,
      shardById('swipe-back'),
      passingBundle(shardById('swipe-back')),
      healthy
    )
    await writeShard(directory, shardById('rtl'))
    const rows = await summarize(manifest, directory)
    assert.deepEqual(
      rows.map(({ id, result, host }) => ({ id, result, host })),
      [
        { id: 'performance', result: 'no evidence', host: 'host unknown: no host-health.json' },
        {
          id: 'rtl',
          result: 'rejected: missing ios-shard-receipt.json',
          host: 'host unknown: no host-health.json'
        },
        {
          id: 'swipe-back',
          result: 'passed (3 cases)',
          host: 'host healthy: 0 of 0 latent-routed gestures in failures'
        },
        {
          id: 'swipeable',
          result: 'rejected: wdio failure, 1 failed case, worker result 1',
          host:
            'host trouble: all 1 failures have latent-routed gestures ' +
            '(1 of 2 latent-routed gestures in failures), load 512.16'
        },
        { id: 'two-sided', result: 'no evidence', host: 'host unknown: no host-health.json' }
      ]
    )
    const markdown = summaryMarkdown(rows)
    assert.match(markdown, /^\| Shard \| Gate checks \| Host \|/m)
    assert.match(
      markdown,
      /^\| swipeable \| rejected: wdio failure, 1 failed case, worker result 1 \| host trouble: .*, load 512\.16 \| 1 \| 1 \| 2 \| 3 \| 512\.16 \| 0\.4 \|$/m
    )
    assert.match(
      markdown,
      /^\| performance \| no evidence \| .* \| n\/a \| n\/a \| n\/a \| n\/a \| n\/a \| n\/a \|$/m
    )
  })
})

test('the summary never shows host trouble when its own gate checks find another failure', async () => {
  await temporary(async (directory) => {
    const shard = shardById('swipeable')
    const health = classifyBundle(failingBundle())
    assert.equal(health.status, 'trouble')
    const failed = failingBundle()
    failed.receipt.maestroOutcome = 'failure'
    await writeShard(directory, shard, failed, health)
    const [row] = await summarize({ ...manifest, shards: [shard] }, directory)
    assert.equal(
      row.host,
      'host mixed: 1 of 1 failures have latent-routed gestures, other gate checks fail too ' +
        '(1 of 2 latent-routed gestures in failures), load 512.16'
    )
  })
})

test('the gate checks cell lists every failing gate condition on one line', async () => {
  await temporary(async (directory) => {
    const shard = shardById('swipeable')
    const bundle = failingBundle()
    bundle.receipt.maestroOutcome = 'failure'
    bundle.workers[0][1].ok = false
    bundle.workers[0][5].status = 'skipped'
    bundle.workers[0].splice(6, 2)
    bundle.receipt.runAttempt = '2'
    await writeShard(directory, shard, bundle)
    const rows = await summarize({ ...manifest, shards: [shard] }, directory)
    const cell =
      'rejected: wdio failure, maestro failure (expected success), warm-up failed, ' +
      '1 failed case, 1 skipped or pending case, 24 of 25 cases finished, worker result 1, ' +
      'Stale receipt: runAttempt'
    assert.equal(rows[0].result, cell)
    assert.ok(
      summaryMarkdown(rows)
        .split('\n')
        .includes(
          `| swipeable | ${cell} | host unknown: no host-health.json | n/a | n/a | n/a | n/a | n/a | n/a |`
        )
    )
  })
})

test('a table cell keeps one line and escapes the column bar', () => {
  const markdown = summaryMarkdown([{ id: 'x', result: 'rejected: a|b\nc', host: 'h' }])
  assert.match(markdown, /^\| x \| rejected: a\\\|b c \| h \|/m)
})

// Each case has step outcomes of success, so a result from the receipt alone says passed.
// Each value is the gate checks cell for the rejection.
const gateRejections = {
  'Warm-up failed': [
    (bundle) => {
      bundle.workers[0][1].ok = false
    },
    'warm-up failed'
  ],
  'Missing/duplicate/unstarted cases': [
    (bundle) => {
      bundle.workers[0].splice(2, 2)
    },
    '24 of 25 cases finished, Missing/duplicate/unstarted cases'
  ],
  'Failed/skipped case': [
    (bundle) => {
      bundle.workers[0][3].status = 'failed'
    },
    '1 failed case'
  ],
  'Worker failed': [
    (bundle) => {
      bundle.workers[0].at(-1).result = 1
    },
    'worker result 1'
  ],
  'Maestro outcome mismatch': [
    (bundle) => {
      bundle.receipt.maestroOutcome = 'failure'
    },
    'maestro failure (expected success)'
  ],
  'Stale receipt: runAttempt': [
    (bundle) => {
      bundle.receipt.runAttempt = '2'
    },
    'Stale receipt: runAttempt'
  ]
}

for (const [reason, [mutate, cell]] of Object.entries(gateRejections)) {
  test(`the summary rejects a shard the gate rejects: ${reason}`, async () => {
    const shard = shardById('swipeable')
    const bundle = passingBundle(shard)
    mutate(bundle)
    const bundles = Object.fromEntries(
      manifest.shards.map((entry) => [entry.id, { attempts: [passingBundle(entry)] }])
    )
    bundles[shard.id] = { attempts: [bundle] }
    const gate = {
      ...context,
      planResult: 'success',
      buildResult: 'success',
      shardsResult: 'success'
    }
    assert.throws(
      () => validateAggregate(manifest, bundles, gate),
      (error) => error.message.split('\n')[0] === reason
    )
    await temporary(async (directory) => {
      await writeShard(directory, shard, bundle)
      const [row] = await summarize({ ...manifest, shards: [shard] }, directory)
      assert.equal(row.result, `rejected: ${cell}`)
    })
  })
}

test('the summary passes a shard only when the gate accepts its evidence', async () => {
  const bundles = Object.fromEntries(
    manifest.shards.map((shard) => [shard.id, passingBundle(shard)])
  )
  const gate = {
    ...context,
    planResult: 'success',
    buildResult: 'success',
    shardsResult: 'success'
  }
  const shardBundles = Object.fromEntries(
    Object.entries(bundles).map(([id, bundle]) => [id, { attempts: [bundle] }])
  )
  assert.equal(validateAggregate(manifest, shardBundles, gate).passed, 62)
  await temporary(async (directory) => {
    for (const shard of manifest.shards) await writeShard(directory, shard, bundles[shard.id])
    const rows = await summarize(manifest, directory)
    assert.deepEqual(
      rows.map((row) => row.result),
      [
        'passed (1 cases)',
        'passed (14 cases)',
        'passed (3 cases)',
        'passed (25 cases)',
        'passed (19 cases)'
      ]
    )
  })
})

test('each top sample has the local time of the host and its 1-minute load average', () => {
  assert.deepEqual(parseLoadSamples(hostLoad), [
    { at: Date.parse('2026-10-17T18:01:14Z'), load: 512.16 },
    { at: Date.parse('2026-10-17T18:01:48Z'), load: 358.33 },
    { at: Date.parse('2026-10-17T18:02:02Z'), load: 348.67 }
  ])
  assert.ok(Number.isNaN(parseLoadSamples('Load Avg: 1.00, 1.00, 1.00\n')[0].at))
})

// Synthetic: attempt 1 of the swipeable shard. Its first case passes at 17:51:30, then its
// afterEach relaunch times out at 17:52:07. Each `top` sample in that window has one load.
const timeoutStart = Date.parse('2026-10-17T17:50:00.000Z')
const timeoutAttempt = (load) =>
  readinessTimeoutAttempt(shardById('swipeable'), context, {
    start: timeoutStart,
    load,
    file: '/checkout/e2e/specs/swipeable.spec.ts'
  })

test('a touch readiness timeout in a relaunch under high load is host trouble', () => {
  const attempt = timeoutAttempt(HIGH_LOAD)
  assert.deepEqual(
    { ...gateCheck(shardById('swipeable'), attempt, context), error: undefined },
    { error: undefined, failedCases: 1, onlyFailedCases: true }
  )
  const health = attempt.health
  assert.equal(health.status, 'trouble')
  assert.equal(health.failuresExplained, 1)
  assert.deepEqual(health.readinessTimeouts, [
    {
      title: 'afterEach',
      start: '2026-10-17T17:51:30.000Z',
      end: '2026-10-17T17:52:07.000Z',
      loadSamples: 4,
      minLoadAverage: HIGH_LOAD,
      highLoad: true
    }
  ])
  assert.equal(
    describeHealth(health),
    'host trouble: all 1 failures have latent-routed gestures or a touch readiness timeout at ' +
      'load 100 or more (0 of 0 latent-routed gestures in failures, 1 of 1 touch readiness ' +
      'timeouts at load 100 or more), load 100'
  )
})

test('the same touch readiness timeout under low load is healthy', () => {
  const health = timeoutAttempt(HIGH_LOAD - 1).health
  assert.equal(health.status, 'healthy')
  assert.equal(health.failuresExplained, 0)
  assert.equal(health.readinessTimeouts[0].highLoad, false)
  assert.equal(
    describeHealth(health),
    'host healthy: 0 of 0 latent-routed gestures in failures, 0 of 1 touch readiness timeouts ' +
      'at load 100 or more'
  )
})

test('a touch readiness timeout needs each load sample in its window at high load', () => {
  const attempt = timeoutAttempt(300)
  const at = (seconds) => timeoutStart + seconds * 1000
  // One sample below the threshold, then no sample in the window at all.
  for (const samples of [
    [
      [at(95), 300],
      [at(105), HIGH_LOAD - 1],
      [at(125), 300]
    ],
    [
      [at(60), 300],
      [at(128), 300]
    ]
  ]) {
    const health = classifyAttempt(
      shardById('swipeable'),
      { ...attempt, hostLoad: topSamples(samples) },
      context
    )
    assert.equal(health.status, 'healthy')
  }
  const noLoad = classifyAttempt(
    shardById('swipeable'),
    { ...attempt, hostLoad: undefined },
    context
  )
  assert.equal(noLoad.status, 'healthy')
  assert.deepEqual(noLoad.missing, ['host-load.txt'])
})

test('a touch readiness timeout inside a case body needs a latent-routed gesture, not load', () => {
  const attempt = timeoutAttempt(300)
  const records = attempt.workers[0]
  const [hook] = records.splice(4, 1)
  Object.assign(records[3], { status: 'failed', error: hook.error })
  records.at(-1).result = 1
  const health = classifyAttempt(shardById('swipeable'), attempt, context)
  assert.deepEqual(health.readinessTimeouts, [])
  assert.notEqual(health.status, 'trouble')
})

// Trimmed from the CI shard evidence of run 39273407706 (swipeable). Its 8 cases passed.
// Then the afterEach relaunch timed out in the touch readiness gate, and the worker
// quarantined the session in that hook. Mocha started none of the other 17 cases. The
// host load of the run has samples from 15:16:55 to 15:20:01 only: the WDIO step then
// sampled its first two minutes. The worker started at 15:21:21.
const run3 = path.join(fixtures, 'run-39273407706')
const run3Context = {
  sha: 'd06730521c230f685bc09a9980ca92d957e47546',
  runId: '39273407706',
  runAttempt: '1'
}
const run3Results = await readFile(path.join(run3, 'swipeable-results.ndjson'), 'utf8')
const run3Evidence = {
  receipt: JSON.parse(await readFile(path.join(run3, 'swipeable-receipt.json'), 'utf8')),
  simulatorLog: await readFile(path.join(run3, 'swipeable-simulator-log.txt'), 'utf8'),
  hostLoad: await readFile(path.join(run3, 'swipeable-host-load.txt'), 'utf8')
}
// The 8 cases that ran, then 17 cases that never started.
const run3Manifest = buildManifest(
  Object.fromEntries(
    Object.entries(EXPECTED_COUNTS).map(([spec, count]) => {
      if (spec === 'specs/swipeable.spec.ts')
        return [
          spec,
          `${registeredCases(run3Results)}\ndescribe("Later tests", () => { for (let i = 0; i < 17; i++) it("case " + i, () => {}) })`
        ]
      return [
        spec,
        `describe("suite", () => { for (let i = 0; i < ${count}; i++) it("case " + i, () => {}) })`
      ]
    })
  ),
  run3Context
)
const run3Shard = run3Manifest.shards.find((shard) => shard.id === 'swipeable')
// Synthetic: four top samples inside the window of the hook, from 15:27:35.902 to 15:28:12.857.
const hookWindowLoad = (load) =>
  topSamples(
    ['15:27:40', '15:27:50', '15:28:00', '15:28:10'].map((time) => [
      Date.parse(`2026-10-19T${time}Z`),
      load
    ])
  )

function run3Attempt(hostLoadText) {
  const attempt = {
    receipt: {
      ...run3Evidence.receipt,
      sourceHash: run3Shard.sourceHash,
      attempt: 1,
      retryReason: null
    },
    workers: [parseRecords(run3Results)],
    simulatorLog: run3Evidence.simulatorLog,
    hostLoad: hostLoadText
  }
  return { ...attempt, health: classifyAttempt(run3Shard, attempt, run3Context) }
}

test('run 39273407706: the relaunch timeout, its quarantine and the unstarted cases are host trouble at high load', () => {
  const attempt = run3Attempt(run3Evidence.hostLoad + hookWindowLoad(300))
  const records = attempt.workers[0]
  assert.equal(records.filter((record) => record.event === 'test-start').length, 8)
  assert.equal(records.at(-1).result, 2)
  assert.deepEqual(
    { ...gateCheck(run3Shard, attempt, run3Context), error: undefined },
    { error: undefined, failedCases: 1, onlyFailedCases: true }
  )
  assert.equal(attempt.health.status, 'trouble')
  assert.equal(attempt.health.latentRoutedGestures, 1)
  assert.equal(attempt.health.latentRoutedInFailures, 0)
  assert.equal(
    retryReason(run3Shard, attempt, run3Context),
    'host trouble: all 1 failures have latent-routed gestures or a touch readiness timeout at ' +
      'load 100 or more (0 of 1 latent-routed gestures in failures, 1 of 1 touch readiness ' +
      'timeouts at load 100 or more), load 385.07'
  )
})

test('run 39273407706: the same relaunch timeout is healthy at low load or without a sample in its window', () => {
  for (const hostLoadText of [
    run3Evidence.hostLoad + hookWindowLoad(20),
    // The run itself: the load samples end before the worker starts.
    run3Evidence.hostLoad
  ]) {
    const attempt = run3Attempt(hostLoadText)
    assert.equal(attempt.health.status, 'healthy')
    assert.match(describeHealth(attempt.health), /^host healthy: 0 of 1 latent-routed gestures/)
    assert.throws(() => retryReason(run3Shard, attempt, run3Context), /A retry needs host trouble/)
  }
})

// Each of these is a rejection that the relaunch timeout of the run does not cause.
const timeoutRejections = {
  'a case after the timeout hook': (records) => {
    const [start, result] = records.slice(2, 4).map((record) => ({
      ...record,
      ...run3Shard.cases[8],
      timestamp: '2026-10-19T15:28:12.900Z'
    }))
    records.splice(-1, 0, start, result)
  },
  'an unfinished case before the timeout hook': (records) => {
    records.splice(-3, 1)
  },
  'a skipped case': (records) => {
    records[3].status = 'skipped'
  },
  'another hook failure': (records) => {
    records.splice(4, 0, { ...records.at(-2), error: { name: 'Error', message: 'other' } })
  },
  'a failed warm-up': (records) => {
    records[1].ok = false
  },
  'a quarantine that starts in another runnable': (records) => {
    records.at(-1).quarantine.runnable = 'Swipeable E2E Tests "after all" hook'
  },
  'a worker that did not finish': (records) => {
    records.pop()
  }
}

for (const [reason, mutate] of Object.entries(timeoutRejections)) {
  test(`run 39273407706: a relaunch timeout at high load with another rejection is not host trouble: ${reason}`, () => {
    const attempt = run3Attempt(run3Evidence.hostLoad + hookWindowLoad(300))
    mutate(attempt.workers[0])
    const check = gateCheck(run3Shard, attempt, run3Context)
    assert.equal(check.passed, undefined)
    assert.equal(check.onlyFailedCases, false)
    const health = classifyAttempt(run3Shard, attempt, run3Context)
    assert.notEqual(health.status, 'trouble')
  })
}

for (const [reason, mutate] of Object.entries({
  'a Maestro failure': (receipt) => {
    receipt.maestroOutcome = 'failure'
  },
  'a cancelled WDIO step': (receipt) => {
    receipt.wdioOutcome = 'cancelled'
  }
})) {
  test(`run 39273407706: a relaunch timeout at high load with ${reason} is not host trouble`, () => {
    const attempt = run3Attempt(run3Evidence.hostLoad + hookWindowLoad(300))
    mutate(attempt.receipt)
    assert.notEqual(classifyAttempt(run3Shard, attempt, run3Context).status, 'trouble')
    assert.throws(() => retryReason(run3Shard, attempt, run3Context))
  })
}

test('a retry follows attempt 1 only, with host trouble in host-health.json and in the evidence', () => {
  const attempt = run3Attempt(run3Evidence.hostLoad + hookWindowLoad(300))
  assert.match(retryReason(run3Shard, attempt, run3Context), /^host trouble: /)
  const retry = (change) => () => {
    const value = structuredClone(attempt)
    change(value)
    retryReason(run3Shard, value, run3Context)
  }
  assert.throws(
    retry((value) => {
      value.receipt.attempt = 2
    }),
    /Only attempt 1 can have a retry/
  )
  assert.throws(
    retry((value) => {
      delete value.health
    }),
    /A retry needs host trouble in host-health.json/
  )
  assert.throws(
    retry((value) => {
      value.hostLoad = run3Evidence.hostLoad
    }),
    /A retry needs host trouble: host healthy/
  )
})

test('the summary has one row for each attempt and gives the gate verdict on the retry', async () => {
  const shard = shardById('swipeable')
  for (const [load, verdict] of [
    [300, '; retry accepted'],
    [20, '; retry rejected: A retry needs host trouble in host-health.json']
  ]) {
    await temporary(async (directory) => {
      const first = timeoutAttempt(load)
      const second = passingBundle(shard)
      second.receipt.attempt = 2
      second.receipt.retryReason = describeHealth(first.health)
      await writeShard(directory, shard, first, first.health, 1)
      await writeShard(directory, shard, second, undefined, 2)
      const rows = await summarize({ ...manifest, shards: [shard] }, directory)
      assert.deepEqual(
        rows.map(({ id }) => id),
        ['swipeable (attempt 1)', 'swipeable (attempt 2)']
      )
      assert.match(rows[0].result, /^rejected: wdio failure, .*1 failed or skipped hook/)
      assert.equal(rows[0].host, describeHealth(first.health))
      assert.equal(rows[1].result, `passed (25 cases)${verdict}`)
    })
  }
})
