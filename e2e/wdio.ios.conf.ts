import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setPlatform } from './helpers/selectors'

const appiumPort = Number(process.env.APPIUM_PORT || 4723)

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
      'appium:noReset': false,
      'appium:isHeadless': true,
      ...(process.env.IOS_PREBUILT_WDA
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

  services: [
    [
      'appium',
      {
        logPath: path.resolve(__dirname, 'logs', `ios-${appiumPort}`),
        args: { address: '127.0.0.1', port: appiumPort }
      }
    ]
  ],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000
  },

  before: async () => {
    setPlatform('iOS')
  },

  afterTest: async (test, _context, { passed }) => {
    const directory = process.env.E2E_ARTIFACT_DIR
    if (passed || !directory) return
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
  }
}
