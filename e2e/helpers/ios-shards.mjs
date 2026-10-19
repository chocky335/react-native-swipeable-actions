import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
// host-health.mjs imports this module too. Each module uses the exports of the other only
// inside its functions, so the import cycle is safe.
import { retryReason } from './host-health.mjs'

const require = createRequire(import.meta.url)
const e2eDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const EXPECTED_COUNTS = Object.freeze({
  'specs/performance.spec.ts': 1,
  'specs/rtl.spec.ts': 14,
  'specs/swipe-back.spec.ts': 3,
  'specs/swipeable.spec.ts': 25,
  'specs/two-sided.spec.ts': 19
})
const TOTAL = 62
const identityKeys = ['sha', 'runId', 'runAttempt']
/** One attempt of a shard, and at most one retry after host trouble (docs/releasing.md). */
export const MAX_ATTEMPTS = 2
/** Each attempt directory `attempt-N/` of a shard artifact has its own receipt. */
export const RECEIPT_FILE = 'ios-shard-receipt.json'
const attemptPattern = /^attempt-([1-9][0-9]*)\//

function identity(value) {
  assert.match(value.sha, /^[a-f0-9]{40}$/, 'full checkout SHA required')
  assert.match(value.runId, /^[1-9][0-9]*$/, 'workflow run ID required')
  assert.match(value.runAttempt, /^[1-9][0-9]*$/, 'workflow attempt required')
  return Object.fromEntries(identityKeys.map((key) => [key, value[key]]))
}

function caseKey(spec, record) {
  return JSON.stringify([spec, record.parent, record.title])
}

// Only registration executes. Imports, hooks, test bodies and driver commands do not.
// Unsupported registration-time application work fails instead of inventing an inventory.
export function collectCases(source, spec) {
  const ts = require('typescript')
  const cases = []
  const parents = []
  const forbidden = () => {
    throw new Error('Application code cannot run during iOS inventory discovery')
  }
  const imported = new Proxy(forbidden, { get: () => imported })
  const rejectSelection = () => {
    throw new Error('Skipped, pending or exclusive registrations are not eligible')
  }
  const describe = (title, callback) => {
    assert.equal(typeof title, 'string')
    assert.equal(typeof callback, 'function', 'pending suite')
    assert.notEqual(callback.constructor.name, 'AsyncFunction', 'async suite registration')
    parents.push(title)
    try {
      callback.call(Object.freeze({}))
    } finally {
      parents.pop()
    }
  }
  const it = (title, callback) => {
    assert.equal(typeof title, 'string')
    assert.equal(typeof callback, 'function', 'pending case')
    cases.push({ title, parent: parents.at(-1) ?? '', fullTitle: [...parents, title].join(' ') })
    return Object.freeze({ timeout: rejectSelection, retries: rejectSelection })
  }
  for (const register of [describe, it]) {
    register.skip = rejectSelection
    register.only = rejectSelection
  }
  const hook = (...args) => {
    assert.equal(typeof args.at(-1), 'function', 'hook callback required')
  }
  const registrations = {
    describe,
    context: describe,
    it,
    specify: it,
    before: hook,
    beforeEach: hook,
    after: hook,
    afterEach: hook
  }
  const sandbox = {
    ...registrations,
    xdescribe: rejectSelection,
    xit: rejectSelection,
    xcontext: rejectSelection,
    driver: Object.freeze({ isIOS: true, isAndroid: false }),
    process: Object.freeze({ env: Object.freeze({ ENABLED_TESTS: '' }) }),
    exports: {},
    require(name) {
      assert.ok(name.startsWith('.'), 'Only inert relative spec imports are allowed')
      return name === '../helpers/scoped-mocha' ? registrations : imported
    }
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: spec,
    reportDiagnostics: true
  })
  assert.equal(
    compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length ?? 0,
    0,
    'invalid TypeScript spec'
  )
  new vm.Script(compiled.outputText, { filename: spec }).runInContext(
    vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } }),
    { timeout: 2000 }
  )
  assert.equal(
    new Set(cases.map((record) => caseKey(spec, record))).size,
    cases.length,
    'ambiguous case identities'
  )
  return cases
}

export function buildManifest(sources, context) {
  assert.deepEqual(
    Object.keys(sources).sort(),
    Object.keys(EXPECTED_COUNTS).sort(),
    'Eligible spec coverage changed: update the reviewed inventory'
  )
  const shards = Object.entries(EXPECTED_COUNTS).map(([spec, count]) => {
    const cases = collectCases(sources[spec], spec)
    assert.equal(cases.length, count, 'Case inventory changed for ' + spec)
    return {
      id: path.basename(spec, '.spec.ts'),
      spec,
      maestro: spec === 'specs/swipeable.spec.ts',
      sourceHash: createHash('sha256').update(sources[spec]).digest('hex'),
      cases
    }
  })
  const manifest = { version: 1, ...identity(context), total: TOTAL, shards }
  validateManifest(manifest)
  return manifest
}

export function validateManifest(manifest) {
  identity(manifest)
  assert.equal(manifest.version, 1)
  assert.equal(manifest.total, TOTAL)
  assert.equal(manifest.shards.length, Object.keys(EXPECTED_COUNTS).length)
  assert.deepEqual(manifest.shards.map((s) => s.spec).sort(), Object.keys(EXPECTED_COUNTS).sort())
  assert.equal(new Set(manifest.shards.map((s) => s.id)).size, manifest.shards.length)
  for (const shard of manifest.shards) {
    assert.equal(shard.id, path.basename(shard.spec, '.spec.ts'))
    assert.equal(shard.maestro, shard.spec === 'specs/swipeable.spec.ts')
    assert.match(shard.sourceHash, /^[a-f0-9]{64}$/)
    assert.equal(shard.cases.length, EXPECTED_COUNTS[shard.spec])
    for (const record of shard.cases) {
      for (const key of ['title', 'parent', 'fullTitle']) assert.equal(typeof record[key], 'string')
      assert.ok(record.title.length > 0)
    }
    assert.equal(
      new Set(shard.cases.map((record) => caseKey(shard.spec, record))).size,
      shard.cases.length,
      'duplicate manifest case'
    )
  }
  return manifest
}

export async function discoverSources(directory = e2eDirectory) {
  const sources = {}
  async function walk(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'Symlinks in the spec tree are not supported')
      const name = relative + '/' + entry.name
      if (entry.isDirectory()) await walk(name)
      else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        sources[name] = await readFile(path.join(directory, name), 'utf8')
      }
    }
  }
  await walk('specs')
  return sources
}

export function parseRecords(text) {
  assert.ok(text.endsWith('\n'), 'Missing/truncated NDJSON evidence')
  return text
    .slice(0, -1)
    .split('\n')
    .map((line) => {
      assert.ok(line.trim(), 'Empty NDJSON record')
      const record = JSON.parse(line)
      assert.ok(
        record && typeof record === 'object' && !Array.isArray(record),
        'Invalid NDJSON record'
      )
      return record
    })
}

function matchesSpec(value, spec) {
  if (typeof value !== 'string') return false
  const filename = value.startsWith('file:') ? fileURLToPath(value) : value
  const normalized = path.posix.normalize(filename.replaceAll('\\', '/'))
  return normalized === spec || normalized.endsWith('/e2e/' + spec)
}

export function validateRecords(shard, records) {
  assert.ok(Array.isArray(records) && records.length > 0, 'Missing worker evidence')
  for (const record of records) {
    assert.ok(
      ['worker-start', 'warm-up', 'test-start', 'test-result', 'worker-end'].includes(record.event),
      'Hook failure/skip or unknown evidence event: ' + record.event
    )
    assert.equal(typeof record.timestamp, 'string')
    assert.ok(Number.isFinite(Date.parse(record.timestamp)), 'Invalid timestamp')
  }
  const first = records[0]
  const last = records.at(-1)
  assert.equal(first.event, 'worker-start')
  assert.equal(records[1]?.event, 'warm-up', 'Missing warm-up evidence')
  assert.equal(records[1].ok, true, 'Warm-up failed')
  assert.equal(last.event, 'worker-end', 'Worker did not finish')
  assert.equal(last.result, 0, 'Worker failed')
  assert.ok(Number.isInteger(first.pid) && first.pid > 0, 'Missing worker PID')
  assert.ok(typeof first.worker === 'string' && first.worker.length > 0, 'Missing worker ID')
  for (const edge of [first, last]) {
    assert.equal(edge.specs?.length, 1, 'One spec per worker required')
    assert.ok(matchesSpec(edge.specs[0], shard.spec), 'Wrong worker spec')
  }
  for (const record of records) {
    assert.equal(record.pid, first.pid, 'Mixed workers')
    assert.equal(record.worker, first.worker, 'Mixed worker identities')
  }
  assert.equal(records.length, 3 + shard.cases.length * 2, 'Missing/duplicate/unstarted cases')
  const expected = new Map(shard.cases.map((record) => [caseKey(shard.spec, record), record]))
  const seen = new Set()
  for (let i = 2; i < records.length - 1; i += 2) {
    const start = records[i]
    const result = records[i + 1]
    assert.equal(start.event, 'test-start', 'Unpaired start')
    assert.equal(result.event, 'test-result', 'Unfinished case')
    const key = caseKey(shard.spec, start)
    assert.ok(expected.has(key), 'Unexpected case: ' + key)
    assert.ok(!seen.has(key), 'Duplicate case: ' + key)
    seen.add(key)
    assert.equal(caseKey(shard.spec, result), key, 'Start/result mismatch')
    for (const record of [start, result]) {
      assert.ok(matchesSpec(record.file, shard.spec), 'Wrong case spec')
      assert.equal(record.attempt, 0, 'Retried case')
      if (record.fullTitle !== undefined)
        assert.equal(record.fullTitle, expected.get(key).fullTitle)
    }
    assert.equal(result.status, 'passed', 'Failed/skipped case')
    assert.ok(result.error == null, 'Case error present')
    assert.ok(!result.pending && !result.skipped, 'Pending/skipped case')
    assert.equal(result.retries?.attempts, 0, 'Retry attempts missing/nonzero')
    assert.equal(result.retries?.limit, 0, 'Retry limit missing/nonzero')
    assert.ok(Number.isFinite(result.duration) && result.duration >= 0, 'Missing duration')
  }
  assert.equal(seen.size, expected.size, 'Incomplete case inventory')
  return seen.size
}

export function artifactName(context, id) {
  identity(context)
  return ['ios-shard', context.sha, context.runId, context.runAttempt, id].join('-')
}

/** The gate checks for one attempt: its receipt, its step outcomes and its worker evidence. */
export function validateShard(shard, { receipt, workers }, context) {
  assert.equal(receipt.version, 1)
  for (const key of identityKeys) assert.equal(receipt[key], context[key], 'Stale receipt: ' + key)
  for (const key of ['id', 'spec', 'sourceHash'])
    assert.equal(receipt[key], shard[key], 'Wrong receipt: ' + key)
  assert.equal(receipt.wdioOutcome, 'success', 'WDIO step did not succeed')
  assert.equal(
    receipt.maestroOutcome,
    shard.maestro ? 'success' : 'skipped',
    'Maestro outcome mismatch'
  )
  assert.equal(workers.length, 1, 'Exactly one worker evidence file per shard required')
  return validateRecords(shard, workers[0])
}

/**
 * The gate checks for one shard and its attempts. Either one attempt passes, or attempt 1
 * fails, `retryReason` permits a retry after it, and attempt 2 passes. The gate classifies
 * attempt 1 again from its raw evidence. Host trouble never passes a case.
 */
export function validateShardEvidence(shard, { attempts }, context) {
  assert.ok(Array.isArray(attempts) && attempts.length > 0, 'Missing attempt evidence')
  assert.ok(attempts.length <= MAX_ATTEMPTS, 'More than one retry')
  for (const [index, attempt] of attempts.entries()) {
    assert.equal(attempt.receipt?.attempt, index + 1, 'Attempt receipt out of order')
  }
  const last = attempts.at(-1)
  const passed = validateShard(shard, last, context)
  if (attempts.length === 1) {
    assert.equal(last.receipt.retryReason, null, 'Retry reason without a retry')
    return passed
  }
  const [first] = attempts
  assert.equal(first.receipt.retryReason, null, 'Retry reason on attempt 1')
  assert.equal(
    last.receipt.retryReason,
    retryReason(shard, first, context),
    'Retry reason differs from the attempt 1 evidence'
  )
  const ended = Date.parse(first.workers.flat().at(-1)?.timestamp)
  assert.ok(
    Date.parse(last.workers[0][0].timestamp) > ended,
    'Attempt 2 started before attempt 1 ended'
  )
  return passed
}

/**
 * Reads one attempt the way the gate does. `names` lists its files by relative path, and
 * `read` returns the text of one. With `logs`, the attempt also has its simulator log and
 * host load: the gate classifies an attempt again before it accepts a retry after it.
 */
async function readAttempt(names, read, logs) {
  const optional = async (name) => (names.includes(name) ? read(name) : undefined)
  const receipt = JSON.parse(await read(RECEIPT_FILE))
  const workers = []
  for (const name of names.filter((entry) => entry.startsWith('ios-results/')).sort()) {
    workers.push(parseRecords(await read(name)))
  }
  // A triage file. A retry check fails closed without it.
  let health
  try {
    health = JSON.parse(await optional('ios-evidence/host-health.json'))
  } catch {
    health = undefined
  }
  return {
    receipt,
    workers,
    health,
    ...(logs && {
      simulatorLog: await optional('ios-evidence/simulator-log.txt'),
      hostLoad: await optional('ios-evidence/host-load.txt')
    })
  }
}

/**
 * Reads one shard artifact the way the gate does: each attempt directory in order. `names`
 * lists every file of the artifact by its relative path, and `read` returns the text of one.
 * Every file must be in attempt-1 to attempt-N, with no gap.
 */
export async function shardBundle(names, read) {
  const numbers = names.map((name) => Number(name.match(attemptPattern)?.[1]))
  assert.ok(numbers.every(Number.isInteger), 'Shard evidence outside an attempt directory')
  const count = Math.max(0, ...numbers)
  const attempts = []
  for (let attempt = 1; attempt <= count; attempt++) {
    const directory = `attempt-${attempt}/`
    const files = names
      .filter((name) => name.startsWith(directory))
      .map((name) => name.slice(directory.length))
    assert.ok(files.length > 0, `Missing attempt directory: ${directory}`)
    attempts.push(await readAttempt(files, (name) => read(directory + name), attempt < count))
  }
  return { attempts }
}

/** Every file below a directory, by its relative path with `/` separators. */
async function listFiles(root, relative = '') {
  const names = []
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) names.push(...(await listFiles(root, name)))
    else names.push(name)
  }
  return names
}

/** Reads one attempt directory the way the gate does. */
export async function loadAttempt(directory, logs = false) {
  const read = (name) => readFile(path.join(directory, name), 'utf8')
  return readAttempt(await listFiles(directory), read, logs)
}

/** Reads one shard artifact the way the gate does. */
export async function loadShardBundle(root) {
  return shardBundle(await listFiles(root), (name) => readFile(path.join(root, name), 'utf8'))
}

export function validateAggregate(manifest, bundles, context) {
  validateManifest(manifest)
  for (const key of identityKeys)
    assert.equal(manifest[key], identity(context)[key], 'Stale plan: ' + key)
  for (const key of ['planResult', 'buildResult', 'shardsResult']) {
    assert.equal(context[key], 'success', 'Required job did not succeed: ' + key)
  }
  assert.deepEqual(
    Object.keys(bundles).sort(),
    manifest.shards.map((s) => s.id).sort(),
    'Missing/extra shard artifacts'
  )
  let passed = 0
  const retried = {}
  for (const shard of manifest.shards) {
    const { attempts } = bundles[shard.id]
    passed += validateShardEvidence(shard, bundles[shard.id], context)
    if (attempts.length > 1) retried[shard.id] = attempts.at(-1).receipt.retryReason
  }
  assert.equal(passed, TOTAL)
  return {
    ...identity(context),
    passed,
    shards: manifest.shards.length,
    maestro: 'success',
    retried
  }
}

function environmentIdentity() {
  return identity({
    sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT
  })
}

async function verifiedPlan(filename, context) {
  const manifest = JSON.parse(await readFile(filename, 'utf8'))
  assert.deepEqual(
    manifest,
    buildManifest(await discoverSources(), context),
    'Plan does not match the current checkout, registration inventory or run'
  )
  return manifest
}

async function save(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}

async function main([command, ...args]) {
  const context = environmentIdentity()
  if (command === 'plan') {
    assert.equal(args.length, 1)
    const manifest = buildManifest(await discoverSources(), context)
    await save(args[0], manifest)
    const matrix = {
      include: manifest.shards.map(({ id, spec, maestro }) => ({ id, spec, maestro }))
    }
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, 'matrix=' + JSON.stringify(matrix) + '\n')
    }
    console.log(JSON.stringify(matrix))
  } else if (command === 'verify-plan') {
    assert.equal(args.length, 1)
    await verifiedPlan(args[0], context)
  } else if (command === 'receipt') {
    assert.equal(args.length, 3)
    const [id, planFile, directory] = args
    const manifest = validateManifest(JSON.parse(await readFile(planFile, 'utf8')))
    for (const key of identityKeys) assert.equal(manifest[key], context[key])
    const shard = manifest.shards.find((entry) => entry.id === id)
    assert.ok(shard, 'Unknown shard')
    const attempt = Number(path.basename(directory).match(/^attempt-([1-9][0-9]*)$/)?.[1])
    assert.ok(attempt >= 1 && attempt <= MAX_ATTEMPTS, 'Expected an attempt directory')
    // The receipt of a retry records why it ran: the host class of attempt 1.
    const previous = path.join(path.dirname(directory), `attempt-${attempt - 1}`)
    await save(path.join(directory, RECEIPT_FILE), {
      version: 1,
      ...context,
      id,
      spec: shard.spec,
      sourceHash: shard.sourceHash,
      attempt,
      retryReason:
        attempt === 1 ? null : retryReason(shard, await loadAttempt(previous, true), manifest),
      wdioOutcome: process.env.IOS_WDIO_OUTCOME,
      maestroOutcome: process.env.IOS_MAESTRO_OUTCOME
    })
  } else if (command === 'aggregate') {
    assert.equal(args.length, 2)
    const [planFile, directory] = args
    const manifest = await verifiedPlan(planFile, context)
    const names = await readdir(directory)
    assert.deepEqual(
      names.sort(),
      manifest.shards.map((s) => artifactName(context, s.id)).sort(),
      'Missing/extra artifact directories'
    )
    const bundles = {}
    for (const shard of manifest.shards) {
      bundles[shard.id] = await loadShardBundle(
        path.join(directory, artifactName(context, shard.id))
      )
    }
    console.log(
      JSON.stringify(
        validateAggregate(manifest, bundles, {
          ...context,
          planResult: process.env.IOS_PLAN_RESULT,
          buildResult: process.env.IOS_BUILD_RESULT,
          shardsResult: process.env.IOS_SHARDS_RESULT
        })
      )
    )
  } else {
    throw new Error('Expected plan, verify-plan, receipt or aggregate')
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
