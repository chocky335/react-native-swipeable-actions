import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  classify,
  describeHealth,
  HEALTH_FILE,
  parseHostLoad,
  parseSimulatorLog,
  report,
  summarize,
  summaryMarkdown
} from './host-health.mjs'

// Trimmed from the CI shard evidence of run 39053954618 (swipeable).
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'host-health')
const simulatorLog = await readFile(path.join(fixtures, 'simulator-log.txt'), 'utf8')
const hostLoad = await readFile(path.join(fixtures, 'host-load.txt'), 'utf8')

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

test('classification: trouble, healthy and unknown', () => {
  const trouble = classify({ simulatorLog, hostLoad })
  assert.equal(trouble.status, 'trouble')
  assert.equal(describeHealth(trouble), 'host trouble: 1 latent-routed gestures, load 512.16')
  const healthyLog = simulatorLog.replaceAll('sceneID:com.swipeabledemo.app', 'sceneID:other')
  const healthy = classify({ simulatorLog: healthyLog, hostLoad: undefined })
  assert.equal(healthy.status, 'healthy')
  assert.deepEqual(healthy.missing, ['host-load.txt'])
  assert.equal(describeHealth(healthy), 'host healthy')
  const noLog = classify({ simulatorLog: undefined, hostLoad })
  assert.equal(noLog.status, 'unknown')
  assert.equal(describeHealth(noLog), 'host unknown: no simulator log')
  const noGestures = classify({ simulatorLog: 'Timestamp Ty Process[PID:TID]\n', hostLoad })
  assert.equal(describeHealth(noGestures), 'host unknown: no gestures in the simulator log')
  assert.equal(describeHealth(undefined), 'host unknown: no host-health.json')
  assert.equal(
    describeHealth(classify({ simulatorLog, hostLoad: undefined })),
    'host trouble: 1 latent-routed gestures, load n/a'
  )
})

test('report writes host-health.json next to the evidence, even without inputs', async () => {
  await temporary(async (directory) => {
    await copyFile(
      path.join(fixtures, 'simulator-log.txt'),
      path.join(directory, 'simulator-log.txt')
    )
    await copyFile(path.join(fixtures, 'host-load.txt'), path.join(directory, 'host-load.txt'))
    const health = await report(directory)
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, HEALTH_FILE), 'utf8')), health)
    assert.deepEqual(health, {
      version: 1,
      status: 'trouble',
      gestures: 2,
      latentRoutedGestures: 1,
      latentRoutedAt: ['2026-10-17 18:04:07.338'],
      loadSamples: 3,
      maxLoadAverage: 512.16,
      minIdlePercent: 0.4,
      missing: []
    })
  })
  await temporary(async (directory) => {
    const health = await report(directory)
    assert.equal(health.status, 'unknown')
    assert.deepEqual(health.missing, ['simulator-log.txt', 'host-load.txt'])
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
      hostLoad
    })
    await shard(
      'swipeable',
      { wdioOutcome: 'failure', maestroOutcome: 'skipped' },
      classify({ simulatorLog, hostLoad })
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
        { id: 'performance', result: 'no evidence', host: 'host unknown: no host-health.json' },
        { id: 'rtl', result: 'no receipt', host: 'host unknown: no host-health.json' },
        { id: 'swipe-back', result: 'passed', host: 'host healthy' },
        {
          id: 'swipeable',
          result: 'failed (wdio failure, maestro skipped)',
          host: 'host trouble: 1 latent-routed gestures, load 512.16'
        }
      ]
    )
    const markdown = summaryMarkdown(rows)
    assert.match(
      markdown,
      /^\| swipeable \| failed \(wdio failure, maestro skipped\) \| host trouble: 1 latent-routed gestures, load 512\.16 \| 2 \| 512\.16 \| 0\.4 \|$/m
    )
    assert.match(markdown, /^\| performance \| no evidence \| .* \| n\/a \| n\/a \| n\/a \|$/m)
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
