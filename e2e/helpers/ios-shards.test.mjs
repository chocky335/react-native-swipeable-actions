import assert from 'node:assert/strict'
import test from 'node:test'
import {
  artifactName,
  buildManifest,
  collectCases,
  discoverSources,
  EXPECTED_COUNTS,
  parseRecords,
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
          receipt: {
            version: 1,
            sha: context.sha,
            runId: context.runId,
            runAttempt: context.runAttempt,
            id: shard.id,
            spec: shard.spec,
            sourceHash: shard.sourceHash,
            wdioOutcome: 'success',
            maestroOutcome: shard.maestro ? 'success' : 'skipped'
          },
          workers: [records]
        }
      ]
    })
  )
  return { plan, bundles, run: { ...context } }
}

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
    maestro: 'success'
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
    delete bundles.rtl.receipt
  },
  'wrong receipt SHA': ({ bundles }) => {
    bundles.rtl.receipt.sha = 'b'.repeat(40)
  },
  'stale run': ({ bundles }) => {
    bundles.rtl.receipt.runId = '122'
  },
  'stale attempt': ({ bundles }) => {
    bundles.rtl.receipt.runAttempt = '2'
  },
  'wrong shard': ({ bundles }) => {
    bundles.rtl.receipt.id = 'swipeable'
  },
  'wrong spec receipt': ({ bundles }) => {
    bundles.rtl.receipt.spec = 'specs/swipeable.spec.ts'
  },
  'wrong source digest': ({ bundles }) => {
    bundles.rtl.receipt.sourceHash = 'b'.repeat(64)
  },
  'failed WDIO': ({ bundles }) => {
    bundles.rtl.receipt.wdioOutcome = 'failure'
  },
  'cancelled WDIO': ({ bundles }) => {
    bundles.rtl.receipt.wdioOutcome = 'cancelled'
  },
  'skipped WDIO': ({ bundles }) => {
    bundles.rtl.receipt.wdioOutcome = 'skipped'
  },
  'failed Maestro': ({ bundles }) => {
    bundles.swipeable.receipt.maestroOutcome = 'failure'
  },
  'missing Maestro': ({ bundles }) => {
    delete bundles.swipeable.receipt.maestroOutcome
  },
  'Maestro on another shard': ({ bundles }) => {
    bundles.rtl.receipt.maestroOutcome = 'success'
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
    bundles.rtl.workers = []
  },
  'duplicate worker file': ({ bundles }) => {
    bundles.rtl.workers.push(bundles.rtl.workers[0])
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
    mutate(value.bundles.rtl.workers[0])
    assert.throws(() => validateAggregate(value.plan, value.bundles, value.run))
  })

test('NDJSON round-trip accepts actual optional fullTitle omission', () => {
  const { plan, bundles } = fixture()
  const records = bundles.rtl.workers[0]
  for (const record of records) delete record.fullTitle
  assert.equal(
    validateRecords(plan.shards[1], parseRecords(records.map(JSON.stringify).join('\n') + '\n')),
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
