const fs = require('node:fs')
const path = require('node:path')
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject
} = require('expo/config-plugins')

// An app built with the iOS 27 SDK stops at launch on iOS 27 without the UIScene lifecycle.
// The Expo SDK 54 template creates its window in the app delegate, so this
// plugin moves the window into a scene delegate.

const SCENE_DELEGATE_FILE = 'SceneDelegate.swift'
const MOVED_MARKER = '// SceneDelegate starts React Native in the window scene.'

const TEMPLATE_WINDOW =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)\n#endif\n/

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate'
      }
    ]
  }
}

const sceneDelegateSource = `import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = appDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions(from: connectionOptions))
  }

  // Linking API
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal Links
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  // A scene app gets its launch URL from the connection options, not from
  // application(_:didFinishLaunchingWithOptions:). Linking.getInitialURL()
  // reads these launch options.
  private func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    if let url = connectionOptions.urlContexts.first?.url {
      return [.url: url]
    }
    if let activity = connectionOptions.userActivities.first {
      return [
        .userActivityDictionary: [
          UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
          "UIApplicationLaunchOptionsUserActivityKey": activity
        ]
      ]
    }
    return nil
  }
}
`

function moveWindowToScene(contents) {
  if (contents.includes(MOVED_MARKER)) return contents
  if (!TEMPLATE_WINDOW.test(contents)) {
    throw new Error(
      'with-scene-lifecycle: the AppDelegate window code differs from the Expo SDK 54 template'
    )
  }
  return contents.replace(TEMPLATE_WINDOW, `\n    ${MOVED_MARKER}\n`)
}

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = sceneManifest
    return mod
  })
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('with-scene-lifecycle: expected a Swift AppDelegate')
    }
    mod.modResults.contents = moveWindowToScene(mod.modResults.contents)
    return mod
  })
  config = withDangerousMod(config, [
    'ios',
    (mod) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot)
      const file = path.join(mod.modRequest.platformProjectRoot, projectName, SCENE_DELEGATE_FILE)
      fs.writeFileSync(file, sceneDelegateSource)
      return mod
    }
  ])
  return withXcodeProject(config, (mod) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot)
    const filepath = `${projectName}/${SCENE_DELEGATE_FILE}`
    if (!mod.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: mod.modResults
      })
    }
    return mod
  })
}

module.exports = withSceneLifecycle
module.exports.moveWindowToScene = moveWindowToScene
module.exports.sceneManifest = sceneManifest
module.exports.sceneDelegateSource = sceneDelegateSource
