import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { finishCommandScope, guardRequest, quarantineState } from './helpers/command-scope'
import { setPlatform } from './helpers/selectors'
import { type TouchReadiness, waitForTouchReadiness } from './helpers/touch-readiness'

const appiumPort = Number(process.env.APPIUM_PORT || 4723)

// CI runs each attempt of a shard in its own directory, e2e/logs/attempt-N. Local runs use e2e/logs.
const logsDirectory = process.env.IOS_ATTEMPT_DIR || path.resolve(__dirname, 'logs')
const resultsDirectory = path.join(logsDirectory, 'ios-results')
const resultsFile = path.join(resultsDirectory, `worker-${process.pid}-${Date.now()}.ndjson`)

function failureDetails(error: unknown) {
  if (error == null) return
  const details = error as { name?: string; message?: string; stack?: string }
  return {
    name: details.name,
    message: details.message ?? String(error),
    stack: details.stack
  }
}

async function recordResult(record: Record<string, unknown>) {
  await mkdir(resultsDirectory, { recursive: true })
  await appendFile(
    resultsFile,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      worker: process.env.WDIO_WORKER_ID,
      ...record
    })}\n`
  )
}

const defaultAppPath = path.resolve(
  process.env.HOME || '',
  'Library/Developer/Xcode/DerivedData/SwipeableDemo-bknrgygfzufodcftotebryellxrc/Build/Products/Release-iphonesimulator/SwipeableDemo.app'
)

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: appiumPort,
  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      platformName: 'iOS',
      'appium:deviceName': process.env.IOS_DEVICE_NAME || 'iPhone 16e',
      ...(process.env.IOS_UDID
        ? { 'appium:udid': process.env.IOS_UDID }
        : { 'appium:udid': '2222B8A8-87C9-468C-AA88-91EF289442DA' }),
      'appium:automationName': 'XCUITest',
      'appium:app': process.env.IOS_APP_PATH || defaultAppPath,
      'appium:bundleId': 'com.swipeabledemo.app',
      'appium:newCommandTimeout': 240,
      'appium:wdaLaunchTimeout': 240000,
      'appium:wdaConnectionTimeout': 240000,
      'appium:showXcodeLog': true,
      // Appium's unfiltered `log stream` loads the CI host. CI saves the system log after the run.
      'appium:skipLogCapture': true,
      'appium:noReset': false,
      'appium:isHeadless': true,
      // CI supplies the full build-for-testing output so Xcode launches XCTest.
      // Keep the existing standalone package option for local callers.
      ...(process.env.IOS_WDA_DERIVED_DATA_PATH
        ? {
            'appium:usePrebuiltWDA': true,
            'appium:derivedDataPath': process.env.IOS_WDA_DERIVED_DATA_PATH
          }
        : process.env.IOS_PREBUILT_WDA
          ? {
              'appium:usePreinstalledWDA': true,
              'appium:prebuiltWDAPath': process.env.IOS_PREBUILT_WDA,
              'appium:updatedWDABundleId': 'com.facebook.WebDriverAgentRunner'
            }
          : {})
    }
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 600000,
  connectionRetryCount: 3,
  transformRequest: guardRequest,

  services: [
    [
      'appium',
      {
        logPath: path.join(logsDirectory, `ios-${appiumPort}`),
        args: { address: '127.0.0.1', port: appiumPort }
      }
    ]
  ],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
    require: [path.resolve(__dirname, 'helpers/command-scope.ts')]
  },

  before: async (_capabilities, specs) => {
    setPlatform('iOS')
    await recordResult({ event: 'worker-start', specs })
    // XCTest starts its virtual touch digitizer on the first synthetic gesture of a
    // session, and the simulator can stall for seconds early in a run. A gesture sent
    // during a stall is lost. Gate the session on a drag that visibly reaches the app.
    // WDIO logs and swallows an error from this hook, so the evidence records the outcome.
    let readiness: TouchReadiness
    try {
      // A cold launch can be slow; relaunches inside 120 s test hooks keep the default.
      readiness = await waitForTouchReadiness({ timeout: 60000 })
    } catch (error) {
      await recordResult({ event: 'warm-up', ok: false, error: String(error) })
      throw error
    }
    await recordResult({ event: 'warm-up', ok: true, ...readiness })
  },

  beforeTest: async (test) => {
    await recordResult({
      event: 'test-start',
      file: test.file,
      title: test.title,
      parent: test.parent,
      fullTitle: test.fullTitle,
      attempt: test._currentRetry ?? 0
    })
  },

  afterHook: finishCommandScope(async (test, _context, result, hookName) => {
    const { error, duration, passed } = result
    // WDIO's Mocha adapter supplies skipped at runtime, but its shared type omits it.
    const skipped = (result as typeof result & { skipped?: boolean }).skipped === true
    if (passed && !error && !skipped) return
    await recordResult({
      // A skipped hook is evidence about that hook, not a count of skipped tests.
      // An actual error always wins, even if the adapter also marks it skipped.
      event: skipped && !error ? 'hook-skipped' : 'hook-failure',
      hook: hookName,
      file: test?.file,
      title: test?.title,
      parent: test?.parent,
      duration,
      error: failureDetails(error)
    })
  }),

  after: async (result, _capabilities, specs) => {
    // A quarantine fails later hooks before WDIO records them. Host health reads its cause here.
    await recordResult({ event: 'worker-end', result, specs, quarantine: quarantineState() })
  },

  afterTest: finishCommandScope(async (test, _context, { passed, error, duration, retries }) => {
    let status = 'failed'
    if (!error && test.pending) {
      status = 'skipped'
    } else if (!error && passed) {
      status = 'passed'
    }
    // Persist the outcome before screenshots/XML, even if evidence capture hangs.
    // A start without a result remains unfinished; never synthesize a pass.
    await recordResult({
      event: 'test-result',
      file: test.file,
      title: test.title,
      parent: test.parent,
      fullTitle: test.fullTitle,
      attempt: test._currentRetry ?? 0,
      status,
      duration,
      retries,
      error: failureDetails(error)
    })
    const directory = process.env.E2E_ARTIFACT_DIR
    if (passed || test.pending || !directory) return
    const title = test.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120)
    const base = path.resolve(directory, `ios-${process.pid}-${Date.now()}-${title}`)
    try {
      await mkdir(path.dirname(base), { recursive: true })
      const captures = await Promise.allSettled([
        driver.saveScreenshot(`${base}.png`),
        driver.getPageSource().then((source) => writeFile(`${base}.xml`, source))
      ])
      for (const capture of captures) {
        if (capture.status === 'rejected') {
          console.warn('iOS failure evidence could not be captured:', capture.reason)
        }
      }
    } catch (error) {
      console.warn('iOS failure evidence directory could not be created:', error)
    }
  })
}
