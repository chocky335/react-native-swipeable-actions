# Support and tested configurations

This page states what 1.0 was tested on. A configuration that is not listed here
can work, but nobody has checked it.

## Requirements

The package is an Expo module with native code.

- It needs a native build with Expo Modules: an Expo development build, `expo run`,
  or a bare React Native app with `install-expo-modules`.
- It needs the New Architecture (Fabric) on iOS and Android. The iOS view does not
  compile on the legacy architecture (Paper).
- It needs Expo SDK 54 or newer, React Native 0.81 or newer and React 19.1 or newer.
- Expo Go cannot load it.
- Rebuild the iOS and Android apps after every install or upgrade. A JavaScript
  reload or an OTA update cannot change native code.

## iOS 27 and the UIScene lifecycle

An app built with the iOS 27 SDK (Xcode 27) stops at launch on iOS 27 if it does not
adopt the UIScene lifecycle. iOS sets this requirement for the app. The Expo SDK 54
app template does not meet it. This package does not cause it and cannot fix it.

- The Expo SDK 54 template creates its window in the app delegate. It has no scene
  delegate.
- The example app adopts the UIScene lifecycle with a local config plugin,
  `example/plugins/with-scene-lifecycle.js`.
- Built with Xcode 27, the example app launched on a physical iPhone 11 Pro Max with
  iOS 27.0.1. Only the launch was checked. The E2E suites did not run on iOS 27.

## Declared ranges

The package declares these ranges. They are minimums, not a tested matrix.

| Declaration | Value |
| --- | --- |
| `expo` peer | `>=54.0.0` |
| `react` peer | `>=19.1.0` |
| `react-native` peer | `>=0.81.0` |
| Architecture | New Architecture (Fabric) only |
| iOS deployment target | 13.4 |
| Android `minSdkVersion` | 23 |

## Tested for 1.0

Every configuration below ran the release candidate. The E2E suite has 62 cases
(25 single-sided, 19 two-sided, 14 RTL, 3 swipe to go back, 1 performance) plus the
Maestro flows.

| Area | Configuration | What ran |
| --- | --- | --- |
| App stack | Expo SDK 54.0, React Native 0.81.5, React 19.1.0 | Example app and a clean app that installs the packed tarball |
| Architecture | New Architecture (Fabric), Hermes | All runs below |
| Android | API 34 x86_64 emulator (Pixel 6 profile) | 62 E2E cases, Robolectric unit tests |
| iOS | iOS 26.4 simulator (iPhone 17 Pro), Xcode 26.6 | 62 E2E cases, Maestro flows, Swift unit tests |
| Packaging | `npm pack` tarball in a clean Expo app | Install, type check, autolinking, release builds on both platforms |

The Swift unit tests run with `swift test` on macOS in the `test-ios` CI job. They
cover the platform-independent helpers and state logic: swipe physics, side
selection, gesture completion, the open-state cache, child roles, rail visibility
and haptic state. They do not load UIKit or the native view. The E2E suites cover
the UIKit view on the simulator.

## Not supported

- The legacy architecture (Paper). The iOS view does not compile on it, and no
  Android run used it.
- Expo SDK below 54, React Native below 0.81 and React below 19.1. The peer ranges
  exclude them.

## Not tested

- iOS versions below the simulator runtime above, and Android API levels other than 34.
- Physical Android devices for 1.0. Earlier 0.x benchmarks used a Pixel 8 Pro.
- Haptics and Reduce Motion on a physical iPhone. The maintainer checks them by
  hand on each release candidate. This page will name the device for 1.0.0.

If you run the package on another configuration, an issue with the result helps,
whether it works or not.

## Reporting a problem

Open an issue at
<https://github.com/chocky335/react-native-swipeable-actions/issues> with the
package version, Expo and React Native versions, the architecture, and the OS and
device.
