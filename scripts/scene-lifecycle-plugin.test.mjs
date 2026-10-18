import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../example/plugins/with-scene-lifecycle.js')

// Excerpt of the Expo SDK 54 template AppDelegate.swift.
const templateAppDelegate = `    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
`

test('the app delegate keeps the factory and no longer creates the window', () => {
  const moved = plugin.moveWindowToScene(templateAppDelegate)
  assert(moved.includes('bindReactNativeFactory(factory)'))
  assert(moved.includes('return super.application(application, didFinishLaunchingWithOptions'))
  assert(!moved.includes('UIWindow(frame:'))
  assert(!moved.includes('startReactNative'))
  assert.equal(plugin.moveWindowToScene(moved), moved, 'A second prebuild must not change the file')
})

test('an unknown app delegate fails the prebuild', () => {
  assert.throws(() => plugin.moveWindowToScene('class AppDelegate {}'), /differs from the Expo SDK 54/)
})

test('Info.plist declares one window scene with the scene delegate', () => {
  assert.equal(plugin.sceneManifest.UIApplicationSupportsMultipleScenes, false)
  const [scene, ...others] = plugin.sceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication
  assert.equal(others.length, 0)
  assert.equal(scene.UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).SceneDelegate')
})

test('the scene delegate starts React Native and forwards links to the app delegate', () => {
  const source = plugin.sceneDelegateSource
  assert.match(source, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/)
  assert.match(source, /UIWindow\(windowScene: windowScene\)/)
  assert.match(source, /startReactNative\(\s*withModuleName: "main",\s*in: window/)
  assert.match(source, /openURLContexts[\s\S]*application\(UIApplication\.shared, open: context\.url/)
  assert.match(source, /continue userActivity: NSUserActivity[\s\S]*continue: userActivity/)
})
