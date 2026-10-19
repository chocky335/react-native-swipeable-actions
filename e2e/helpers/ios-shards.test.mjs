import assert from 'node:assert/strict'
import test from 'node:test'
import { readinessTimeoutAttempt } from './fixtures/host-trouble.mjs'
import { describeHealth } from './host-health.mjs'
import {
  artifactName,
  buildManifest,
  collectCases,
  discoverSources,
  EXPECTED_COUNTS,
  parseRecords,
  shardBundle,
  validateAggregate,
  validateManifest,
  validateRecords
} from './ios-shards.mjs'

const context = {
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  planResult: 'success',
  buildResult: 'success',
  shardsResult: 'success'
}
const sources = Object.fromEntries(
  Object.entries(EXPECTED_COUNTS).map(([spec, count]) => [
    spec,
    'describe("suite", () => { for (let i = 0; i < ' +
      count +
      '; i++) it("case " + i, () => { throw new Error("body must not run") }) })'
  ])
)
const manifest = buildManifest(sources, context)

function fixture() {
  const plan = structuredClone(manifest)
  const bundles = Object.fromEntries(
    plan.shards.map((shard) => {
      const common = { timestamp: '2026-10-16T12:00:00.000Z', pid: 42, worker: '0-0' }
      const spec = '/checkout/e2e/' + shard.spec
      const records = [
        { ...common, event: 'worker-start', specs: ['file://' + spec] },
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
      records.push({ ...common, event: 'worker-end', specs: ['file://' + spec], result: 0 })
      return [
        shard.id,
        {
          attempts: [
            {
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
                wdioOutcome: 'success',
                maestroOutcome: shard.maestro ? 'success' : 'skipped'
              },
              workers: [records]
            }
          ]
        }
      ]
    })
  )
  return { plan, bundles, run: { ...context } }
}

/** The only attempt of a shard in `fixture`. */
const only = (bundle) => bundle.attempts[0]

test('real checkout discovers every eligible spec and all 62 cases without executing bodies', async () => {
  const actual = buildManifest(await discoverSources(), context)
  assert.deepEqual(
    actual.shards.map((s) => s.cases.length),
    [1, 14, 3, 25, 19]
  )
  assert.equal(actual.shards.filter((s) => s.maestro).length, 1)
  assert.equal(actual.shards.find((s) => s.maestro).id, 'swipeable')
})

test('registration preserves nested titles and loop expansion, never executing imports/hooks/bodies', () => {
  const result = collectCases(
    'import { it, beforeEach } from "../helpers/scoped-mocha"; import { driverCall } from "../helpers/example"; describe("outer", () => { beforeEach(() => driverCall()); for (const side of ["left", "right"]) describe(side, () => { it("opens", () => { throw Error("not executed") }) }) })',
    'specs/example.spec.ts'
  )
  assert.deepEqual(
    result.map((c) => [c.parent, c.fullTitle]),
    [
      ['left', 'outer left opens'],
      ['right', 'outer right opens']
    ]
  )
})

for (const [name, source] of Object.entries({
  'skipped test': 'it.skip("x", () => {})',
  'exclusive test': 'it.only("x", () => {})',
  'skipped suite': 'describe.skip("x", () => {})',
  'exclusive suite': 'describe.only("x", () => {})',
  'pending test': 'it("x")',
  'pending suite': 'describe("x")',
  'duplicate identity': 'it("x", () => {}); it("x", () => {})',
  'registration device operation': 'import { x } from "../helpers/example"; x()',
  'external import': 'import fs from "node:fs"; fs.readFileSync("x")',
  'altered deadline': 'it("x", () => {}).timeout(999)',
  'altered retries': 'it("x", () => {}).retries(1)',
  'async suite': 'describe("x", async () => {})'
}))
  test('inventory rejects ' + name, () =>
    assert.throws(() => collectCases(source, 'specs/x.spec.ts'))
  )

for (const [name, mutate] of Object.entries({
  'missing spec': (s) => {
    delete s['specs/rtl.spec.ts']
  },
  'new eligible spec': (s) => {
    s['specs/nested/new.spec.ts'] = 'it("new", () => {})'
  },
  'added case': (s) => {
    s['specs/performance.spec.ts'] += '; it("extra", () => {})'
  },
  'missing case': (s) => {
    s['specs/performance.spec.ts'] = ''
  }
}))
  test('coverage guard rejects ' + name, () => {
    const value = { ...sources }
    mutate(value)
    assert.throws(() => buildManifest(value, context))
  })

test('source changes bind a new digest even when titles are unchanged', () => {
  const changed = buildManifest(
    {
      ...sources,
      'specs/performance.spec.ts': sources['specs/performance.spec.ts'] + '\n// changed'
    },
    context
  )
  assert.notEqual(changed.shards[0].sourceHash, manifest.shards[0].sourceHash)
})

test('healthy aggregate requires all 62 cases and Maestro exactly once', () => {
  const { plan, bundles, run } = fixture()
  assert.deepEqual(validateAggregate(plan, bundles, run), {
    sha: context.sha,
    runId: '123',
    runAttempt: '1',
    passed: 62,
    shards: 5,
    maestro: 'success',
    retried: {}
  })
})

const mutations = {
  'missing artifact': ({ bundles }) => {
    delete bundles.rtl
  },
  'extra artifact': ({ bundles }) => {
    bundles.extra = bundles.rtl
  },
  'missing receipt': ({ bundles }) => {
    delete only(bundles.rtl).receipt
  },
  'wrong receipt SHA': ({ bundles }) => {
    only(bundles.rtl).receipt.sha = 'b'.repeat(40)
  },
  'stale run': ({ bundles }) => {
    only(bundles.rtl).receipt.runId = '122'
  },
  'stale attempt': ({ bundles }) => {
    only(bundles.rtl).receipt.runAttempt = '2'
  },
  'wrong shard': ({ bundles }) => {
    only(bundles.rtl).receipt.id = 'swipeable'
  },
  'wrong spec receipt': ({ bundles }) => {
    only(bundles.rtl).receipt.spec = 'specs/swipeable.spec.ts'
  },
  'wrong source digest': ({ bundles }) => {
    only(bundles.rtl).receipt.sourceHash = 'b'.repeat(64)
  },
  'failed WDIO': ({ bundles }) => {
    only(bundles.rtl).receipt.wdioOutcome = 'failure'
  },
  'cancelled WDIO': ({ bundles }) => {
    only(bundles.rtl).receipt.wdioOutcome = 'cancelled'
  },
  'skipped WDIO': ({ bundles }) => {
    only(bundles.rtl).receipt.wdioOutcome = 'skipped'
  },
  'failed Maestro': ({ bundles }) => {
    only(bundles.swipeable).receipt.maestroOutcome = 'failure'
  },
  'missing Maestro': ({ bundles }) => {
    delete only(bundles.swipeable).receipt.maestroOutcome
  },
  'Maestro on another shard': ({ bundles }) => {
    only(bundles.rtl).receipt.maestroOutcome = 'success'
  },
  'failed shard job': ({ run }) => {
    run.shardsResult = 'failure'
  },
  'cancelled shard job': ({ run }) => {
    run.shardsResult = 'cancelled'
  },
  'skipped shard job': ({ run }) => {
    run.shardsResult = 'skipped'
  },
  'failed build': ({ run }) => {
    run.buildResult = 'failure'
  },
  'failed plan': ({ run }) => {
    run.planResult = 'failure'
  },
  'wrong plan SHA': ({ plan }) => {
    plan.sha = 'b'.repeat(40)
  },
  'wrong total': ({ plan }) => {
    plan.total = 61
  },
  'duplicate manifest shard': ({ plan }) => {
    plan.shards[1] = plan.shards[0]
  },
  'duplicate manifest case': ({ plan }) => {
    plan.shards[1].cases[1] = plan.shards[1].cases[0]
  },
  'missing worker file': ({ bundles }) => {
    only(bundles.rtl).workers = []
  },
  'duplicate worker file': ({ bundles }) => {
    only(bundles.rtl).workers.push(only(bundles.rtl).workers[0])
  },
  'missing attempt': ({ bundles }) => {
    bundles.rtl.attempts = []
  },
  'attempt receipt without its attempt number': ({ bundles }) => {
    delete only(bundles.rtl).receipt.attempt
  },
  'attempt 2 without attempt 1': ({ bundles }) => {
    only(bundles.rtl).receipt.attempt = 2
  },
  'retry reason without a retry': ({ bundles }) => {
    only(bundles.rtl).receipt.retryReason = 'host trouble: all 1 failures'
  },
  'missing retry reason field': ({ bundles }) => {
    delete only(bundles.rtl).receipt.retryReason
  },
  'a green attempt repeated as its own retry': ({ bundles }) => {
    const second = structuredClone(only(bundles.rtl))
    second.receipt.attempt = 2
    bundles.rtl.attempts.push(second)
  }
}
for (const [name, mutate] of Object.entries(mutations))
  test('aggregate rejects ' + name, () => {
    const value = fixture()
    mutate(value)
    assert.throws(() => validateAggregate(value.plan, value.bundles, value.run))
  })

const recordMutations = {
  'unstarted case': (r) => r.splice(2, 2),
  'duplicate case replacing another': (r) => {
    r[4] = { ...r[2] }
    r[5] = { ...r[3] }
  },
  'extra duplicate case': (r) => r.splice(4, 0, { ...r[2] }, { ...r[3] }),
  'wrong title': (r) => {
    r[2].title = 'not registered'
  },
  'mismatched result': (r) => {
    r[3].title = 'different'
  },
  'mismatched parent': (r) => {
    r[2].parent = 'different'
  },
  'mismatched full title': (r) => {
    r[3].fullTitle = 'different'
  },
  'wrong file': (r) => {
    r[3].file = '/checkout/e2e/specs/swipeable.spec.ts'
  },
  'failed case': (r) => {
    r[3].status = 'failed'
  },
  'skipped case': (r) => {
    r[3].status = 'skipped'
  },
  'pending case': (r) => {
    r[3].pending = true
  },
  'error with passed status': (r) => {
    r[3].error = { message: 'failure' }
  },
  'retry attempt': (r) => {
    r[2].attempt = 1
  },
  'transported retry result': (r) => {
    r[3].retries.attempts = 1
  },
  'retry limit': (r) => {
    r[3].retries.limit = 1
  },
  'missing retry evidence': (r) => {
    delete r[3].retries
  },
  'missing duration': (r) => {
    delete r[3].duration
  },
  'missing result': (r) => r.splice(3, 1),
  'missing worker end': (r) => r.pop(),
  'failed worker end': (r) => {
    r.at(-1).result = 1
  },
  'mixed worker PID': (r) => {
    r[3].pid = 43
  },
  'mixed worker ID': (r) => {
    r[3].worker = '0-1'
  },
  'wrong worker spec': (r) => {
    r[0].specs = ['file:///checkout/e2e/specs/swipeable.spec.ts']
  },
  'multiple worker specs': (r) => {
    r[0].specs.push(r[0].specs[0])
  },
  'hook failure': (r) => r.splice(-1, 0, { ...r[0], event: 'hook-failure' }),
  'hook skipped': (r) => r.splice(-1, 0, { ...r[0], event: 'hook-skipped' }),
  'late hook failure after worker end': (r) => r.push({ ...r[0], event: 'hook-failure' }),
  'result before start': (r) => {
    ;[r[2], r[3]] = [r[3], r[2]]
  },
  'invalid timestamp': (r) => {
    r[3].timestamp = 'invalid'
  },
  'missing warm-up': (r) => r.splice(1, 1),
  'failed warm-up': (r) => {
    r[1] = { ...r[1], ok: false, error: 'Error: title not displayed' }
  },
  'warm-up without outcome': (r) => {
    delete r[1].ok
  },
  'duplicate warm-up': (r) => r.splice(-1, 0, { ...r[1] }),
  'warm-up after the first case': (r) => {
    ;[r[1], r[2], r[3]] = [r[2], r[3], r[1]]
  }
}
for (const [name, mutate] of Object.entries(recordMutations))
  test('evidence rejects ' + name, () => {
    const value = fixture()
    mutate(only(value.bundles.rtl).workers[0])
    assert.throws(() => validateAggregate(value.plan, value.bundles, value.run))
  })

test('NDJSON round-trip accepts actual optional fullTitle omission', () => {
  const { plan, bundles } = fixture()
  const records = only(bundles.rtl).workers[0]
  for (const record of records) delete record.fullTitle
  assert.equal(
    validateRecords(plan.shards[1], parseRecords(records.map(JSON.stringify).join('\n') + '\n')),
    14
  )
})
test('the gate reads the worker-end quarantine field as evidence only', () => {
  const { plan, bundles, run } = fixture()
  for (const bundle of Object.values(bundles)) only(bundle).workers[0].at(-1).quarantine = null
  assert.equal(validateAggregate(plan, bundles, run).passed, 62)
  const records = only(bundles.rtl).workers[0]
  records.at(-1).quarantine = {
    reason: 'unresolved request when "suite case 0" ended',
    runnable: 'suite case 0'
  }
  assert.equal(
    validateRecords(plan.shards[1], parseRecords(`${records.map(JSON.stringify).join('\n')}\n`)),
    14
  )
})
for (const text of ['', '{}', '{\n', '\n', 'null\n', '[]\n', '{}\n\n']) {
  test('malformed/truncated NDJSON is rejected: ' + JSON.stringify(text), () => {
    assert.throws(() => parseRecords(text))
  })
}

test('artifact names distinguish shard, SHA, run and attempt', () => {
  const variants = [
    artifactName(context, 'rtl'),
    artifactName(context, 'swipeable'),
    artifactName({ ...context, sha: 'b'.repeat(40) }, 'rtl'),
    artifactName({ ...context, runId: '124' }, 'rtl'),
    artifactName({ ...context, runAttempt: '2' }, 'rtl')
  ]
  assert.equal(new Set(variants).size, 5)
  assert.throws(() => artifactName({ ...context, sha: 'short' }, 'rtl'))
  assert.throws(() => validateManifest({ ...manifest, runAttempt: '' }))
})

// Attempt 1 ends at 11:02:07 in a touch readiness timeout. The fixture records of
// attempt 2 are at 12:00:00.
const attemptStart = Date.parse('2026-10-16T11:00:00.000Z')

/**
 * A swipeable shard with a retry: attempt 1 times out in a relaunch at the given load,
 * and attempt 2 is the green fixture attempt. Its receipt gives the attempt 1 host class.
 */
function retried(load = 300) {
  const value = fixture()
  const shard = value.plan.shards.find((entry) => entry.id === 'swipeable')
  const first = readinessTimeoutAttempt(shard, context, {
    start: attemptStart,
    load,
    file: `/checkout/e2e/${shard.spec}`
  })
  const second = only(value.bundles.swipeable)
  second.receipt.attempt = 2
  second.receipt.retryReason = describeHealth(first.health)
  value.bundles.swipeable.attempts = [first, second]
  return value
}

test('aggregate accepts one retry after host trouble in attempt 1 and a green attempt 2', () => {
  const { plan, bundles, run } = retried()
  const [first] = bundles.swipeable.attempts
  assert.equal(first.health.status, 'trouble')
  const result = validateAggregate(plan, bundles, run)
  assert.equal(result.passed, 62)
  assert.deepEqual(result.retried, { swipeable: describeHealth(first.health) })
  assert.match(result.retried.swipeable, /^host trouble: .*1 of 1 touch readiness timeouts/)
})

const noChange = () => {}
// Each entry gives the attempt 1 load, a change to the attempts, and the gate message.
const retryRejections = {
  'attempt 1 healthy at low load': [
    20,
    noChange,
    /^A retry needs host trouble in host-health\.json/
  ],
  'host trouble only in host-health.json, not in the raw evidence': [
    20,
    ([first, second]) => {
      first.health = retried().bundles.swipeable.attempts[0].health
      second.receipt.retryReason = describeHealth(first.health)
    },
    /^A retry needs host trouble: host healthy: .*0 of 1 touch readiness timeouts/
  ],
  'attempt 1 without host-health.json': [
    300,
    ([first]) => {
      delete first.health
    },
    /^A retry needs host trouble in host-health\.json/
  ],
  'attempt 1 without its host load': [
    300,
    ([first]) => {
      delete first.hostLoad
    },
    /^A retry needs host trouble: host healthy/
  ],
  'attempt 1 with a Maestro failure': [
    300,
    ([first]) => {
      first.receipt.maestroOutcome = 'failure'
    },
    /^A Maestro step never gets a retry/
  ],
  'attempt 1 cancelled': [
    300,
    ([first]) => {
      first.receipt.wdioOutcome = 'cancelled'
    },
    /^A retry needs a failed WDIO step/
  ],
  'attempt 1 with a retry reason': [
    300,
    ([first]) => {
      first.receipt.retryReason = 'host trouble'
    },
    /^Retry reason on attempt 1/
  ],
  'retry reason that differs from the attempt 1 evidence': [
    300,
    ([, second]) => {
      second.receipt.retryReason = 'host trouble: something else'
    },
    /^Retry reason differs from the attempt 1 evidence/
  ],
  'attempt 2 without a retry reason': [
    300,
    ([, second]) => {
      second.receipt.retryReason = null
    },
    /^Retry reason differs from the attempt 1 evidence/
  ],
  'attempt 2 incomplete': [
    300,
    ([, second]) => {
      second.workers[0].splice(2, 2)
    },
    /^Missing\/duplicate\/unstarted cases/
  ],
  'attempt 2 with a failed case': [
    300,
    ([, second]) => {
      second.workers[0][3].status = 'failed'
    },
    /^Failed\/skipped case/
  ],
  'attempt 2 with a retried case': [
    300,
    ([, second]) => {
      second.workers[0][2].attempt = 1
    },
    /^Retried case/
  ],
  'attempt 2 with Mocha retry attempts': [
    300,
    ([, second]) => {
      second.workers[0][3].retries.attempts = 1
    },
    /^Retry attempts missing\/nonzero/
  ],
  'attempt 2 with a failed Maestro step': [
    300,
    ([, second]) => {
      second.receipt.maestroOutcome = 'failure'
    },
    /^Maestro outcome mismatch/
  ],
  'attempt 2 that starts before attempt 1 ends': [
    300,
    ([, second]) => {
      for (const record of second.workers[0]) record.timestamp = '2026-10-16T11:01:00.000Z'
    },
    /^Attempt 2 started before attempt 1 ended/
  ],
  'three attempts': [
    300,
    (attempts) => {
      const third = structuredClone(attempts[1])
      third.receipt.attempt = 3
      attempts.push(third)
    },
    /^More than one retry/
  ],
  'attempts out of order': [
    300,
    (attempts) => {
      attempts.reverse()
    },
    /^Attempt receipt out of order/
  ]
}
for (const [name, [load, mutate, message]] of Object.entries(retryRejections))
  test(`aggregate rejects a retry: ${name}`, () => {
    const { plan, bundles, run } = retried(load)
    mutate(bundles.swipeable.attempts)
    assert.throws(
      () => validateAggregate(plan, bundles, run),
      (error) => message.test(error.message.split('\n')[0])
    )
  })

test('the gate reads each attempt directory of a shard artifact in order', async () => {
  const { bundles } = retried()
  const [first, second] = bundles.swipeable.attempts
  const ndjsonText = (records) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  const files = {
    'attempt-1/ios-shard-receipt.json': JSON.stringify(first.receipt),
    'attempt-1/ios-results/worker-41-1.ndjson': ndjsonText(first.workers[0]),
    'attempt-1/ios-evidence/host-health.json': JSON.stringify(first.health),
    'attempt-1/ios-evidence/simulator-log.txt': first.simulatorLog,
    'attempt-1/ios-evidence/host-load.txt': first.hostLoad,
    'attempt-1/ios-4723/wdio-appium.log': 'appium\n',
    'attempt-2/ios-shard-receipt.json': JSON.stringify(second.receipt),
    'attempt-2/ios-results/worker-42-2.ndjson': ndjsonText(second.workers[0]),
    'attempt-2/ios-evidence/simulator-log.txt': 'not read for the last attempt\n'
  }
  const read = (name) => {
    assert.ok(name in files, `read of a missing file: ${name}`)
    return files[name]
  }
  const bundle = await shardBundle(Object.keys(files), read)
  assert.deepEqual(bundle.attempts, [first, { ...second, health: undefined }])
  assert.equal('simulatorLog' in bundle.attempts[1], false)
  const attempt1 = Object.keys(files).filter((name) => name.startsWith('attempt-1/'))
  await assert.rejects(
    shardBundle([...Object.keys(files), 'ios-shard-receipt.json'], read),
    /Shard evidence outside an attempt directory/
  )
  await assert.rejects(
    shardBundle([...attempt1, 'attempt-3/ios-shard-receipt.json'], read),
    /Missing attempt directory: attempt-2\//
  )
  assert.deepEqual(await shardBundle([], read), { attempts: [] })
})
