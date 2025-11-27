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
      platformName: 'iOS',
      'appium:deviceName': 'iPhone 16e',
      'appium:udid': 'FB06EE9A-2A15-44A1-8DF5-638E9C0C04A0',
      'appium:automationName': 'XCUITest',
      'appium:app': path.resolve(
        process.env.HOME || '',
        'Library/Developer/Xcode/DerivedData/SwipeableDemo-bknrgygfzufodcftotebryellxrc/Build/Products/Debug-iphonesimulator/SwipeableDemo.app'
      ),
      'appium:bundleId': 'com.swipeabledemo.app',
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
    setPlatform('iOS')
  }
}
