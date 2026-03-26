import type { Options } from '@wdio/types'
import path from 'node:path'
import { setPlatform } from './helpers/selectors'

const defaultAppPath = path.resolve(
  process.env.HOME || '',
  'Library/Developer/Xcode/DerivedData/SwipeableDemo-bknrgygfzufodcftotebryellxrc/Build/Products/Release-iphonesimulator/SwipeableDemo.app'
)

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
      'appium:noReset': false
    }
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 600000,
  connectionRetryCount: 3,

  services: [['appium', { logPath: './logs' }]],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000
  },

  before: async () => {
    setPlatform('iOS')
  }
}
