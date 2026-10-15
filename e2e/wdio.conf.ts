import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { finishCommandScope, guardRequest } from './helpers/command-scope'
import { setPlatform } from './helpers/selectors'

// Use APPIUM_PORT for both the client and the service, including concurrent platform runs.
const appiumPort = Number(process.env.APPIUM_PORT || 4723)

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: appiumPort,
  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      platformName: 'Android',
      'appium:deviceName': 'Android Device',
      ...(process.env.ANDROID_UDID ? { 'appium:udid': process.env.ANDROID_UDID } : {}),
      'appium:automationName': 'UiAutomator2',
      'appium:app':
        process.env.ANDROID_APP_PATH ||
        path.resolve(__dirname, '../example/android/app/build/outputs/apk/release/app-release.apk'),
      'appium:appPackage': 'com.swipeabledemo.app',
      'appium:appActivity': '.MainActivity',
      'appium:enforceAppInstall': true,
      'appium:newCommandTimeout': 240,
      'appium:noReset': false
    }
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  transformRequest: guardRequest,

  services: [
    [
      'appium',
      {
        logPath: path.resolve(__dirname, 'logs', `android-${appiumPort}`),
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

  before: async () => {
    setPlatform('Android')
    // Both UiAutomator2 waits default to 10000 ms, including native selectors.
    // Keep animations enabled and let explicit test waits establish readiness.
    await driver.updateSettings({
      waitForIdleTimeout: 100,
      waitForSelectorTimeout: 100,
      // React Native testIDs are raw resource IDs, without a package prefix.
      disableIdLocatorAutocompletion: true
    })
  },

  afterHook: finishCommandScope(async () => {}),

  afterTest: finishCommandScope(async (test, _context, { passed }) => {
    const directory = process.env.E2E_ARTIFACT_DIR
    if (passed || !directory) return
    const title = test.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120)
    const base = path.resolve(directory, `android-${process.pid}-${Date.now()}-${title}`)
    try {
      await mkdir(path.dirname(base), { recursive: true })
      const captures = await Promise.allSettled([
        driver.saveScreenshot(`${base}.png`),
        driver.getPageSource().then((source) => writeFile(`${base}.xml`, source))
      ])
      for (const capture of captures) {
        if (capture.status === 'rejected') {
          console.warn('Android failure evidence could not be captured:', capture.reason)
        }
      }
    } catch (error) {
      console.warn('Android failure evidence directory could not be created:', error)
    }
  })
}
