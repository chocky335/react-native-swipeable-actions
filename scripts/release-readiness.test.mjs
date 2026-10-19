import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildManifest, EXPECTED_COUNTS } from '../e2e/helpers/ios-shards.mjs'
import { REQUIRED_JOBS, validateReadiness, validateSource } from './release-readiness.mjs'

// Synthetic records exercise the gate only. They are never release evidence.
const sha = 'a'.repeat(40)
const sources = Object.fromEntries(Object.entries(EXPECTED_COUNTS).map(([spec, count]) => [
  spec, 'describe("suite", () => { for (let i = 0; i < ' + count + '; i++) it("case " + i, () => {}) })'
]))
function fixture(version = '1.0.0-rc.0', runIds = [101]) {
  const bytes = Buffer.from('synthetic tarball fixture; never publish')
  const digest = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  const pkg = { name: 'react-native-swipeable-actions', version }
  const value = {
    sourceSha: sha, workflowSha: sha, ref: 'refs/heads/main', repository: 'owner/repo', version, pkg,
    lock: { version, packages: { '': { version } } },
    changelog: '## Unreleased\n\n## ' + version + ' - 2026-10-16\n\nBreaking explicit-side API.\n',
    runs: runIds.map((id) => {
      const context = { sha, runId: String(id), runAttempt: '1' }
      const manifest = buildManifest(sources, context)
      const run = { id, head_sha: sha, repository: { full_name: 'owner/repo' }, path: '.github/workflows/ci.yml',
        event: 'workflow_dispatch', head_branch: 'main', run_attempt: 1, status: 'completed', conclusion: 'success',
        run_started_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T12:00:00Z' }
      const jobs = REQUIRED_JOBS.map((name, index) => ({ id: id * 100 + index, name, run_id: id, head_sha: sha,
        status: 'completed', conclusion: 'success', steps: [
          { name: 'Run E2E tests', conclusion: 'success' },
          { name: 'Run Maestro seekbar regression test', conclusion: 'success' },
          { name: 'Run Swift unit tests', conclusion: 'success' }
        ] }))
      const bundles = Object.fromEntries(manifest.shards.map((shard, index) => {
        const common = { timestamp: '2026-10-16T11:00:00Z', pid: 100, worker: '0-' + index }
        const file = '/checkout/e2e/' + shard.spec
        const records = [{ ...common, event: 'worker-start', specs: [file] }, { ...common, event: 'warm-up', ok: true }]
        for (const entry of shard.cases) {
          records.push({ ...common, ...entry, file, attempt: 0, event: 'test-start' })
          records.push({ ...common, ...entry, file, attempt: 0, event: 'test-result', status: 'passed', duration: 1, retries: { attempts: 0, limit: 0 } })
        }
        records.push({ ...common, event: 'worker-end', specs: [file], result: 0 })
        return [shard.id, { receipt: { version: 1, ...context, id: shard.id, spec: shard.spec,
          sourceHash: shard.sourceHash, wdioOutcome: 'success', maestroOutcome: shard.maestro ? 'success' : 'skipped' }, workers: [records] }]
      }))
      const androidLog = manifest.shards.map((shard, index) =>
        shard.cases.map((entry) => '[app Android #0-' + index + '] \u2713 ' + entry.title).join('\n') +
        '\n[0-' + index + '] PASSED in Android - file:///checkout/e2e/' + shard.spec
      ).join('\n') + '\nSpec Files: 5 passed, 5 total (100% completed)\n'
      return { run, jobs, manifest, expectedManifest: structuredClone(manifest), bundles, androidLog,
        report: { sourceSha: sha, cleanSource: true, version, filename: 'package.tgz', integrity: digest, files: ['package.json'] },
        bytes, packedPackage: pkg }
    })
  }
  return value
}

for (const version of ['1.0.0-rc.0', '1.0.0-rc.12', '1.0.0']) {
  test('accepts complete synthetic evidence for exact ' + version, () => {
    const result = validateReadiness(fixture(version))
    assert.equal(result.tag, 'v' + version)
    assert.equal(result.distTag, version.includes('-rc.') ? 'next' : 'latest')
    assert.deepEqual(result.ciRuns, [101])
  })
}
test('accepts one complete fresh full CI run', () => {
  const value = fixture()
  assert.equal(value.runs.length, 1)
  assert.deepEqual(validateReadiness(value).ciRuns, [101])
})
test('rejects zero CI runs', () => {
  const value = fixture()
  value.runs = []
  assert.throws(() => validateReadiness(value), /Exactly one fresh, fully green full CI run required/)
})
test('rejects two complete CI runs: exactly one is required', () => {
  const value = fixture('1.0.0-rc.0', [101, 102])
  assert.throws(() => validateReadiness(value), /Exactly one fresh, fully green full CI run required/)
})
const mutations = {
  'old unprepared version': (v) => { v.pkg = { ...v.pkg, version: '0.1.12' } },
  'arbitrary branch': (v) => { v.ref = 'refs/heads/feature' },
  'different workflow revision': (v) => { v.workflowSha = 'b'.repeat(40) },
  'short source SHA': (v) => { v.sourceSha = '96a9c59' },
  'lock mismatch': (v) => { v.lock.version = '0.1.12' },
  'lock root mismatch': (v) => { v.lock.packages[''].version = '0.1.12' },
  'missing release heading': (v) => { v.changelog = '## Unreleased - upcoming 1.0.0\nNotes' },
  'duplicate release heading': (v) => { v.changelog += v.changelog },
  'empty release notes': (v) => { v.changelog = '## 1.0.0-rc.0 - 2026-10-16\n\n## Unreleased\nfuture' },
  'invalid date': (v) => { v.changelog = v.changelog.replace('2026-10-16', '2026-02-30') },
  'failed final CI 38930587069': (v) => { v.runs[0].run.id = 38930587069; v.runs[0].run.conclusion = 'failure' },
  'stale CI SHA': (v) => { v.runs[0].run.head_sha = 'b'.repeat(40) },
  'foreign repository': (v) => { v.runs[0].run.repository.full_name = 'other/repo' },
  'wrong workflow': (v) => { v.runs[0].run.path = '.github/workflows/publish.yml' },
  'pull request merge source': (v) => { v.runs[0].run.event = 'pull_request' },
  'CI from feature branch': (v) => { v.runs[0].run.head_branch = 'feature' },
  'rerun of failed jobs': (v) => { v.runs[0].run.run_attempt = 2 },
  'unfinished run': (v) => { v.runs[0].run.status = 'in_progress' },
  'missing package job': (v) => { v.runs[0].jobs = v.runs[0].jobs.filter((j) => j.name !== 'package') },
  'missing Swift test job': (v) => { v.runs[0].jobs = v.runs[0].jobs.filter((j) => j.name !== 'test-ios') },
  'Swift tests skipped': (v) => { v.runs[0].jobs.find((j) => j.name === 'test-ios').steps[2].conclusion = 'skipped' },
  'Swift test step omitted': (v) => { v.runs[0].jobs.find((j) => j.name === 'test-ios').steps = [] },
  'duplicate job': (v) => { v.runs[0].jobs.push(v.runs[0].jobs[0]) },
  'skipped job': (v) => { v.runs[0].jobs[0].conclusion = 'skipped' },
  'stale job': (v) => { v.runs[0].jobs[0].head_sha = 'b'.repeat(40) },
  'test step omitted': (v) => { v.runs[0].jobs.find((j) => j.name === 'e2e-android').steps = [] },
  'Maestro skipped': (v) => { v.runs[0].jobs.find((j) => j.name === 'iOS / swipeable').steps[1].conclusion = 'skipped' },
  'metadata-only evidence': (v) => { v.runs[0].bundles = {} },
  'stale inventory': (v) => { v.runs[0].manifest.shards[0].sourceHash = 'b'.repeat(64) },
  'missing iOS worker': (v) => { v.runs[0].bundles.rtl.workers = [] },
  'missing iOS case': (v) => { v.runs[0].bundles.swipeable.workers[0].splice(2, 2) },
  'failed iOS case': (v) => { v.runs[0].bundles['two-sided'].workers[0][3].status = 'failed' },
  'retried iOS case': (v) => { v.runs[0].bundles.rtl.workers[0][3].retries.attempts = 1 },
  'replayed old records': (v) => { v.runs[0].bundles.rtl.workers[0][0].timestamp = '2026-10-15T11:00:00Z' },
  'Android summary only': (v) => { v.runs[0].androidLog = 'Spec Files: 5 passed, 5 total\n' },
  'Android missing case': (v) => { v.runs[0].androidLog = v.runs[0].androidLog.replace('[app Android #0-0] \u2713 case 0', '') },
  'Android duplicate output': (v) => { v.runs[0].androidLog += v.runs[0].androidLog },
  'Android skipped case': (v) => { v.runs[0].androidLog += '1 skipped\n' },
  'Android retried case': (v) => { v.runs[0].androidLog += '1 retried\n' },
  'Android repeated title replaces missing title': (v) => { v.runs[0].androidLog = v.runs[0].androidLog.replace('[app Android #0-1] \u2713 case 1\n', '[app Android #0-1] \u2713 case 0\n') },
  'dirty package source': (v) => { v.runs[0].report.cleanSource = false },
  'wrong package source': (v) => { v.runs[0].report.sourceSha = 'b'.repeat(40) },
  'wrong package version': (v) => { v.runs[0].report.version = '0.1.12' },
  'modified tarball': (v) => { v.runs[0].bytes = Buffer.from('different') },
  'unsafe filename': (v) => { v.runs[0].report.filename = '../package.tgz' },
  'actual packed version mismatch': (v) => { v.runs[0].packedPackage = { ...v.pkg, version: '0.1.12' } }
}
test('accepts exact case multisets despite nested-suite display order, timestamps and ANSI colors', () => {
  const value = fixture()
  for (const run of value.runs) {
    run.androidLog = run.androidLog.trim().split('\n').reverse().map(
      (line) => '2026-10-16T11:00:00.000Z \u001b[32m' + line + '\u001b[0m'
    ).join('\n') + '\n'
  }
  assert.equal(validateReadiness(value).version, '1.0.0-rc.0')
})
test('accepts the worker-end quarantine field of current iOS evidence', () => {
  const value = fixture()
  for (const run of value.runs) {
    for (const bundle of Object.values(run.bundles)) bundle.workers[0].at(-1).quarantine = null
  }
  assert.equal(validateReadiness(value).version, '1.0.0-rc.0')
})
for (const [name, mutate] of Object.entries(mutations)) {
  test('fails closed: ' + name, () => {
    const value = fixture()
    mutate(value)
    assert.throws(() => validateReadiness(value))
  })
}
test('requires both complete 62-case mobile inventories', () => {
  const value = fixture()
  for (const evidence of value.runs) {
    assert.equal(evidence.manifest.shards.reduce((count, shard) => count + shard.cases.length, 0), 62)
  }
  assert.deepEqual(validateReadiness(value).ciRuns, [101])
})

// Exercise the actual workflow shell boundaries with functions that replace git/npm.
// These tests never invoke real git, contact a remote, create tags or publish packages.
// Directory changes are real: git must resolve the checkout while npm uses the artifact directory.
const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
const workflowSteps = workflow.split('\n      - ').slice(1)
const approvalStep = 'Recheck remote main after environment approval'
const tagStep = 'Establish immutable source tag before publishing'
const publishStep = 'Publish exactly the tested tarball'
function workflowStep(name) {
  const step = workflowSteps.find((entry) => entry.startsWith('name: ' + name + '\n'))
  assert.ok(step, 'Missing workflow boundary: ' + name)
  return step
}
function runWorkflowStep(name, overrides = {}, transformScript = (script) => script) {
  const block = workflowStep(name).split('\n        run: |\n')[1]
  assert.ok(block, 'Expected literal shell block: ' + name)
  const script = block.split('\n').map((line) => line.slice(10)).join('\n')
  const mocks = `
    git() {
      local repository_directory="$PWD"
      if [ "$1" = '-C' ]; then
        repository_directory="$2"
        shift 2
      fi
      printf '%s\\t%s\\n' "$PWD" "$repository_directory" >> "$GIT_CONTEXT_LOG"
      if [ "$repository_directory" != "$GITHUB_WORKSPACE" ]; then
        printf 'Git command did not resolve the checkout\\n' >&2
        return 128
      fi
      case "$1 $2" in
        'ls-remote --exit-code')
          test "$*" = 'ls-remote --exit-code --heads origin refs/heads/main' || return 92
          test "$REMOTE_FAILURE" = 0 || return 93
          printf '%s\\trefs/heads/main\\n' "$MAIN_SHA" ;;
        'ls-remote --tags')
          if [ -n "$REMOTE_TAG_SHA" ]; then printf '%s\\trefs/tags/v%s\\n' "$REMOTE_TAG_SHA" "$RELEASE_VERSION"; fi ;;
        'fetch --no-tags') : ;;
        'rev-parse FETCH_HEAD^{commit}') printf '%s\\n' "$REMOTE_TAG_SHA" ;;
        tag*)
          printf 'mutation:tag\\n'
          if [ "$ADVANCE_AFTER_TAG" = 1 ]; then MAIN_SHA=${'b'.repeat(40)}; fi ;;
        push*) printf 'mutation:push\\n' ;;
        *) return 94 ;;
      esac
    }
    npm() {
      test "$PWD" = "$RUNNER_TEMP/verified-release" || return 95
      test -f ./package.tgz || return 96
      printf 'mutation:npm %s\\n' "$*"
    }
  `
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), 'release-workflow-')))
  const workspace = path.join(temporary, 'checkout with spaces')
  const runnerTemp = path.join(temporary, 'runner temp')
  const artifactDirectory = path.join(runnerTemp, 'verified-release')
  const contextLog = path.join(temporary, 'git-context.log')
  try {
    mkdirSync(workspace)
    mkdirSync(artifactDirectory, { recursive: true })
    writeFileSync(path.join(artifactDirectory, 'package.tgz'), 'synthetic artifact; never publish')
    writeFileSync(contextLog, '')
    const result = spawnSync('bash', ['-c', mocks + '\n' + transformScript(script)], {
      cwd: workspace, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, RELEASE_SOURCE: sha, GITHUB_SHA: sha, RELEASE_VERSION: '1.0.0-rc.0',
        MAIN_SHA: sha, REMOTE_TAG_SHA: '', REMOTE_FAILURE: '0', ADVANCE_AFTER_TAG: '0', ...overrides,
        GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runnerTemp, GIT_CONTEXT_LOG: contextLog }
    })
    const gitContexts = readFileSync(contextLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const [cwd, repository] = line.split('\t')
      return { cwd, repository }
    })
    return { ...result, workspace, artifactDirectory, gitContexts }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

test('workflow checks main inside the environment-protected job before evidence work', () => {
  assert.match(workflow, /environment: npm-release/)
  const index = workflowSteps.findIndex((step) => step.startsWith('name: ' + approvalStep + '\n'))
  assert.ok(index > 0)
  assert.match(workflowSteps[index - 1], /^uses: actions\/checkout@/)
  assert.ok(index < workflowSteps.findIndex((step) => step.startsWith('name: Verify source,')))
  for (const name of [tagStep, publishStep]) assert.match(workflowStep(name), /if: inputs\.operation == 'publish'/)
})

for (const name of [approvalStep, tagStep, publishStep]) {
  test('blocks stale main at workflow boundary: ' + name, () => {
    const result = runWorkflowStep(name, { MAIN_SHA: 'b'.repeat(40) })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1, result.stderr)
    assert.doesNotMatch(result.stdout, /mutation:/)
  })
  test('fails closed on remote failure at workflow boundary: ' + name, () => {
    const result = runWorkflowStep(name, { REMOTE_FAILURE: '1' })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 93, result.stderr)
    assert.doesNotMatch(result.stdout, /mutation:/)
  })
}

test('checks main again immediately before pushing a newly created tag', () => {
  const result = runWorkflowStep(tagStep, { ADVANCE_AFTER_TAG: '1' })
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, 'mutation:tag\n')
})

test('allows matching main through tag and exact RC tarball publication boundaries', () => {
  for (const name of [approvalStep, tagStep, publishStep]) {
    const result = runWorkflowStep(name)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    if (name === tagStep) assert.equal(result.stdout, 'mutation:tag\nmutation:push\n')
    if (name === publishStep) assert.equal(result.stdout, 'mutation:npm publish ./package.tgz --tag next --ignore-scripts --provenance\n')
  }
})

for (const [version, distTag] of [['1.0.0-rc.0', 'next'], ['1.0.0', 'latest']]) {
  test('checks checkout main after real artifact-directory cd for ' + version, () => {
    const result = runWorkflowStep(publishStep, { RELEASE_VERSION: version })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.notEqual(result.artifactDirectory, result.workspace)
    assert.deepEqual(result.gitContexts, [{ cwd: result.artifactDirectory, repository: result.workspace }])
    assert.equal(result.stdout, 'mutation:npm publish ./package.tgz --tag ' + distTag + ' --ignore-scripts --provenance\n')
  })
}

test('negative control catches the original unanchored git command after real cd', () => {
  const result = runWorkflowStep(publishStep, {}, (script) => script.replaceAll('git -C "$GITHUB_WORKSPACE"', 'git'))
  assert.equal(result.error, undefined)
  assert.equal(result.status, 128)
  assert.deepEqual(result.gitContexts, [{ cwd: result.artifactDirectory, repository: result.artifactDirectory }])
  assert.match(result.stderr, /Git command did not resolve the checkout/)
  assert.doesNotMatch(result.stdout, /mutation:/)
})

test('existing immutable tag may be reused only at the tested source', () => {
  const matching = runWorkflowStep(tagStep, { REMOTE_TAG_SHA: sha })
  assert.equal(matching.status, 0, matching.stderr)
  assert.equal(matching.stdout, '')
  const conflicting = runWorkflowStep(tagStep, { REMOTE_TAG_SHA: 'b'.repeat(40) })
  assert.equal(conflicting.error, undefined)
  assert.notEqual(conflicting.status, 0)
  assert.doesNotMatch(conflicting.stdout, /mutation:/)
})
for (const version of ['prerelease', 'major', '0.1.13-rc.0', '1.0.0-canary.0', '1.0.0-rc.01', 'v1.0.0', '1.0.0+build']) {
  test('rejects unsupported or inferred version ' + version, () => {
    const value = fixture()
    value.version = version
    assert.throws(() => validateSource(value))
  })
}
