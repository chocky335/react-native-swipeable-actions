import type { Options } from '@wdio/types'
import path from 'path'
import { setPlatform } from './helpers/selectors'

export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      transpileOnly: true,
      project: './tsconfig.json'
    }
  },

  specs: ['./specs/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      platformName: 'Android',
      'appium:deviceName': 'Android Device',
      'appium:automationName': 'UiAutomator2',
      'appium:app': path.resolve(
        __dirname,
        '../example/android/app/build/outputs/apk/release/app-release.apk'
      ),
      'appium:appPackage': 'com.swipeabledemo.app',
      'appium:appActivity': '.MainActivity',
      'appium:newCommandTimeout': 240,
      'appium:noReset': false
    }
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  services: ['appium'],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000
  },

  before: async function () {
    setPlatform('Android')
    // Debug: wait for app to fully render then dump page source
    await driver.pause(5000)
    const source = await driver.getPageSource()
    console.log('=== PAGE SOURCE (first 3000 chars) ===')
    console.log(source.substring(0, 3000))
    console.log('=== END PAGE SOURCE ===')
  }
}
