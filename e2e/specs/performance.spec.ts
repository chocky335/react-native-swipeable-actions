import { selectors } from '../helpers/selectors'
import { configPanel } from '../pages/configPanel'
import { listDemoPage } from '../pages/listDemoPage'

// Configure which tests to run (empty = all tests, 0-indexed)
// prettier-ignore
const ENABLED_TESTS: number[] = process.env.ENABLED_TESTS
  ? process.env.ENABLED_TESTS.split(',').map((n) => parseInt(n, 10))
  : []

const shouldRun = (testNum: number) => ENABLED_TESTS.length === 0 || ENABLED_TESTS.includes(testNum)

describe('Swipeable Performance Tests', () => {
  afterEach(async () => {
    const appId = 'com.swipeabledemo.app'
    await driver.terminateApp(appId)
    await driver.activateApp(appId)
    await listDemoPage.waitForDisplayed()
  })
  ;(shouldRun(0) ? describe : describe.skip)(
    'Benchmark 0: run-benchmark produces a result string',
    () => {
      it('should run benchmark and surface FPS result', async () => {
        await configPanel.open()
        await configPanel.tapRunBenchmark()

        // Benchmark starts (HUD shows "Benchmarking..." with testID benchmark-running)
        await $(selectors.benchmarkRunning).waitForDisplayed({ timeout: 10000 })

        // Benchmark completes within ~60s (3 repeats × ~10s each + overhead)
        await $(selectors.benchmarkResult).waitForDisplayed({ timeout: 90000 })

        const resultText = await $(selectors.benchmarkResultText).getText()
        // Result format: "Avg: 116.8 | Min: 60.0 | Max: 120.0"
        expect(resultText).toMatch(/Avg:\s*[\d.]+\s*\|\s*Min:\s*[\d.]+\s*\|\s*Max:\s*[\d.]+/)
      })
    }
  )
})
