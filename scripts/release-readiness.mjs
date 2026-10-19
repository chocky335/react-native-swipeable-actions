import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  artifactName,
  buildManifest,
  discoverSources,
  parseRecords,
  validateAggregate
} from '../e2e/helpers/ios-shards.mjs'

export const REQUIRED_JOBS = Object.freeze([
  'lint', 'test', 'test-ios', 'package', 'build-ios', 'e2e-android', 'ios-plan',
  'iOS / performance', 'iOS / rtl', 'iOS / swipe-back', 'iOS / swipeable', 'iOS / two-sided',
  'e2e-ios'
])
const packageName = 'react-native-swipeable-actions'
const shaPattern = /^[a-f0-9]{40}$/
const idPattern = /^[1-9][0-9]*$/
const integrity = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64')

export function validateSource({ sourceSha, workflowSha, ref, version, pkg, lock, changelog }) {
  assert.match(sourceSha, shaPattern, 'Full source SHA required')
  assert.equal(sourceSha, workflowSha, 'Publish only the prepared workflow revision')
  assert.equal(ref, 'refs/heads/main', 'Release workflow must run from main')
  assert.match(version, /^1\.0\.0(?:-rc\.(?:0|[1-9][0-9]*))?$/, 'Exact v1 stable or RC version required')
  assert.equal(pkg.name, packageName)
  assert.equal(pkg.version, version, 'Prepare and test the exact package version first')
  assert.equal(lock.version, version, 'Lockfile version differs')
  assert.equal(lock.packages?.['']?.version, version, 'Lockfile root version differs')
  const headings = [...changelog.matchAll(/^## (\S+) - (\d{4}-\d{2}-\d{2})\s*$/gm)]
    .filter((match) => match[1] === version)
  assert.equal(headings.length, 1, 'Exactly one finalized changelog entry for the version required')
  const date = headings[0][2]
  assert.equal(new Date(date).toISOString().slice(0, 10), date, 'Invalid release date')
  const body = changelog.slice(headings[0].index + headings[0][0].length).split(/^## /m)[0]
  assert.ok(body.trim().length > 0, 'Empty release notes')
  return { tag: 'v' + version, distTag: version.includes('-rc.') ? 'next' : 'latest' }
}

export function validateRun(run, jobs, { sourceSha, repository }) {
  assert.match(String(run.id), idPattern)
  assert.equal(run.head_sha, sourceSha, 'CI source differs from release source')
  assert.equal(run.repository?.full_name, repository, 'Wrong evidence repository')
  assert.equal(run.path, '.github/workflows/ci.yml', 'Evidence must come from maintained CI')
  assert.equal(run.event, 'workflow_dispatch', 'Full manual CI run required')
  assert.equal(run.head_branch, 'main', 'Evidence must test prepared main source')
  assert.equal(run.run_attempt, 1, 'A fresh full run is required; rerunning failed jobs is not release evidence')
  assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'success', 'CI did not fully succeed')
  assert.ok(Number.isFinite(Date.parse(run.run_started_at)))
  assert.ok(Date.parse(run.updated_at) >= Date.parse(run.run_started_at))
  assert.equal(new Set(jobs.map((job) => job.name)).size, jobs.length, 'Duplicate job identities')
  for (const name of REQUIRED_JOBS) assert.ok(jobs.some((job) => job.name === name), 'Missing job: ' + name)
  for (const job of jobs) {
    assert.equal(job.run_id, run.id, 'Job belongs to another run')
    assert.equal(job.head_sha, sourceSha, 'Job source differs')
    assert.equal(job.status, 'completed', 'Unfinished job: ' + job.name)
    assert.equal(job.conclusion, 'success', 'Unsuccessful job: ' + job.name)
  }
  for (const name of ['e2e-android', 'iOS / performance', 'iOS / rtl', 'iOS / swipe-back', 'iOS / swipeable', 'iOS / two-sided']) {
    const steps = jobs.find((job) => job.name === name).steps
    assert.equal(steps?.find((step) => step.name === 'Run E2E tests')?.conclusion, 'success', 'Missing successful test execution: ' + name)
  }
  assert.equal(jobs.find((job) => job.name === 'test-ios').steps?.find(
    (step) => step.name === 'Run Swift unit tests'
  )?.conclusion, 'success', 'Swift unit tests must actually execute')
  assert.equal(jobs.find((job) => job.name === 'iOS / swipeable').steps?.find(
    (step) => step.name === 'Run Maestro seekbar regression test'
  )?.conclusion, 'success', 'Maestro must actually execute')
}

export function validatePackage(report, bytes, version, sourceSha, packedPackage) {
  assert.equal(report.sourceSha, sourceSha, 'Package source differs')
  assert.equal(report.cleanSource, true, 'Package must come from clean committed source')
  assert.equal(report.version, version, 'Tested package version differs')
  assert.match(report.filename, /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/, 'Unsafe package filename')
  assert.equal(report.integrity, integrity(bytes), 'Tested package integrity differs')
  assert.ok(Array.isArray(report.files) && report.files.length > 0, 'Package inventory missing')
  assert.equal(packedPackage.name, packageName)
  assert.equal(packedPackage.version, version, 'Actual tarball version differs')
  return report.integrity
}

// Validate actual WDIO spec-reporter output, not a self-authored passed-count receipt.
// Fail closed if the reporter format changes; update against real logs, never invent success.
export function validateAndroidLog(log, manifest) {
  const text = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  assert.equal([...text.matchAll(/Spec Files:\s*5 passed,\s*5 total\b/g)].length, 1, 'Missing complete Android run summary')
  assert.ok(!/\b[1-9][0-9]* (?:failing|pending|skipped|failed|retried)\b/i.test(text), 'Android failures, retries or skips')
  assert.ok(!/\[[0-9]+-[0-9]+\] RETRYING\b/.test(text), 'Retried Android worker')
  const completed = [...text.matchAll(/\[([0-9]+-[0-9]+)\] PASSED[^\r\n]*?((?:file:\/\/)?\/[^\r\n]*?\/specs\/[^\s]+\.spec\.ts)\s*$/gm)]
  assert.equal(completed.length, manifest.shards.length, 'Missing/duplicate Android workers')
  const seen = new Set()
  for (const [, worker, filename] of completed) {
    const shard = manifest.shards.find((entry) => filename.endsWith('/' + entry.spec))
    assert.ok(shard && !seen.has(shard.id), 'Wrong/duplicate Android spec')
    seen.add(shard.id)
    const titles = []
    for (const line of text.split('\n')) {
      const record = line.match(/\[[^\]\r\n]* #([0-9]+-[0-9]+)\]\s+[✓✔]\s+(.+?)\s*$/u)
      if (record?.[1] === worker) {
        const exactTitle = shard.cases.some((entry) => entry.title === record[2])
        titles.push(exactTitle ? record[2] : record[2].replace(/ \([0-9.]+(?:ms|s)\)$/, ''))
      }
    }
    // Reporters group nested suites; registration and display order can differ.
    assert.deepEqual(titles.sort(), shard.cases.map((entry) => entry.title).sort(), 'Android passing case inventory differs: ' + shard.id)
  }
  assert.equal(seen.size, 5)
}

export function validateReadiness(input) {
  const release = validateSource(input)
  assert.equal(input.runs.length, 1, 'Exactly one fresh, fully green full CI run required')
  const [{ run, jobs, manifest, expectedManifest, bundles, androidLog, report, bytes, packedPackage }] = input.runs
  validateRun(run, jobs, input)
  assert.deepEqual(manifest, expectedManifest, 'Inventory must match the checked-out test sources')
  assert.equal(manifest.sha, input.sourceSha)
  assert.equal(manifest.runId, String(run.id))
  assert.equal(manifest.runAttempt, String(run.run_attempt))
  validateAggregate(manifest, bundles, {
    sha: input.sourceSha, runId: String(run.id), runAttempt: String(run.run_attempt),
    planResult: 'success', buildResult: 'success', shardsResult: 'success'
  })
  for (const bundle of Object.values(bundles)) {
    for (const record of bundle.workers[0]) {
      const time = Date.parse(record.timestamp)
      assert.ok(time >= Date.parse(run.run_started_at) && time <= Date.parse(run.updated_at), 'Worker evidence is outside this run')
    }
  }
  validateAndroidLog(androidLog, manifest)
  const packageIntegrity = validatePackage(report, bytes, input.version, input.sourceSha, packedPackage)
  return { schemaVersion: 1, sourceSha: input.sourceSha, version: input.version, ...release,
    packageIntegrity, ciRuns: [run.id] }
}

async function main(args) {
  assert.equal(args.length, 8, 'Expected --source SHA --version VERSION --runs ID --out DIRECTORY')
  const options = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [args[i * 2], args[i * 2 + 1]]))
  assert.deepEqual(Object.keys(options).sort(), ['--out', '--runs', '--source', '--version'])
  const sourceSha = options['--source']
  const version = options['--version']
  const repository = process.env.GITHUB_REPOSITORY
  assert.match(repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  assert.ok(process.env.GH_TOKEN, 'GitHub evidence authentication required')
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceSha)
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '', 'Tracked source must be clean')
  const input = {
    sourceSha, version, repository, workflowSha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF,
    pkg: JSON.parse(await readFile('package.json', 'utf8')),
    lock: JSON.parse(await readFile('package-lock.json', 'utf8')),
    changelog: await readFile('CHANGELOG.md', 'utf8'), runs: []
  }
  validateSource(input)
  const runIds = options['--runs'].split(',')
  assert.equal(runIds.length, 1, 'Exactly one full CI run ID required')
  for (const id of runIds) assert.match(id, idPattern)
  const base = 'https://api.github.com/repos/' + repository
  const request = async (route) => {
    const response = await fetch(base + route, {
      headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(120000)
    })
    assert.ok(response.ok, 'GitHub evidence request failed: ' + response.status + ' ' + route)
    return response
  }
  const json = async (route) => (await request(route)).json()
  const list = async (route, key) => {
    const entries = []
    for (let page = 1; page <= 20; page++) {
      const data = await json(route + '?per_page=100&page=' + page)
      entries.push(...data[key])
      if (entries.length === data.total_count) return entries
      assert.ok(data[key].length > 0 && entries.length < data.total_count, 'Inconsistent GitHub pagination')
    }
    throw new Error('Evidence pagination exceeded limit')
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'release-readiness-'))
  try {
    const sources = await discoverSources()
    for (const runId of runIds) {
      const run = await json('/actions/runs/' + runId)
      const jobs = await list('/actions/runs/' + runId + '/attempts/1/jobs', 'jobs')
      validateRun(run, jobs, input)
      const artifacts = await list('/actions/runs/' + runId + '/artifacts', 'artifacts')
      const archive = async (name) => {
        const matches = artifacts.filter((artifact) => artifact.name === name)
        assert.equal(matches.length, 1, 'Missing/duplicate artifact: ' + name)
        const artifact = matches[0]
        assert.equal(artifact.expired, false, 'Expired evidence: ' + name)
        assert.ok(artifact.size_in_bytes > 0 && artifact.size_in_bytes < 256 * 1024 * 1024, 'Invalid artifact size')
        const bytes = Buffer.from(await (await request('/actions/artifacts/' + artifact.id + '/zip')).arrayBuffer())
        const filename = path.join(temporary, String(artifact.id) + '.zip')
        await writeFile(filename, bytes)
        const names = execFileSync('unzip', ['-Z1', filename], { encoding: 'utf8' }).trim().split('\n').filter((entry) => !entry.endsWith('/'))
        assert.equal(new Set(names).size, names.length, 'Duplicate archive entries')
        const read = (entry) => {
          assert.match(entry, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/, 'Unsupported evidence filename')
          assert.ok(!entry.split('/').includes('..'), 'Unsafe evidence filename')
          assert.ok(names.includes(entry), 'Missing evidence file: ' + entry)
          return execFileSync('unzip', ['-p', filename, entry], { maxBuffer: 64 * 1024 * 1024 })
        }
        return { names, read, json: (entry) => JSON.parse(read(entry).toString('utf8')) }
      }
      const context = { sha: sourceSha, runId, runAttempt: '1' }
      const planArchive = await archive('ios-plan-' + sourceSha + '-' + runId + '-1')
      const manifest = planArchive.json('manifest.json')
      const expectedManifest = buildManifest(sources, context)
      assert.deepEqual(manifest, expectedManifest, 'Plan is not from the prepared checkout')
      const bundles = {}
      for (const shard of manifest.shards) {
        const zip = await archive(artifactName(context, shard.id))
        bundles[shard.id] = {
          receipt: zip.json('ios-shard-receipt.json'),
          workers: zip.names.filter((name) => name.startsWith('ios-results/')).map(
            (name) => parseRecords(zip.read(name).toString('utf8'))
          )
        }
      }
      const androidJob = jobs.find((job) => job.name === 'e2e-android')
      const androidLog = await (await request('/actions/jobs/' + androidJob.id + '/logs')).text()
      const npmArchive = await archive('npm-package-' + sourceSha)
      const report = npmArchive.json('package-artifact.json')
      assert.match(report.filename, /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/)
      const bytes = npmArchive.read(report.filename)
      const tarball = path.join(temporary, runId + '.tgz')
      await writeFile(tarball, bytes)
      const packedPackage = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
      input.runs.push({ run, jobs, manifest, expectedManifest, bundles, androidLog, report, bytes, packedPackage })
    }
    const result = validateReadiness(input)
    await mkdir(options['--out'], { recursive: true })
    await writeFile(path.join(options['--out'], 'package.tgz'), input.runs[0].bytes, { flag: 'wx' })
    await writeFile(path.join(options['--out'], 'release-readiness.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
