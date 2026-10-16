# Support and tested configurations

This page states what 1.0 was tested on. A configuration that is not listed here
can work, but nobody has checked it.

## Requirements

The package is an Expo module with native code.

- It needs a native build with Expo Modules: an Expo development build, `expo run`,
  or a bare React Native app with `install-expo-modules`.
- Expo Go cannot load it.
- Rebuild the iOS and Android apps after every install or upgrade. A JavaScript
  reload or an OTA update cannot change native code.

## Declared ranges

The package declares these ranges. They are minimums, not a tested matrix.

| Declaration | Value |
| --- | --- |
| `expo` peer | `>=50.0.0` |
| `react` peer | `>=18.0.0` |
| `react-native` peer | `>=0.73.0` |
| iOS deployment target | 13.4 |
| Android `minSdkVersion` | 23 |

## Tested for 1.0

Every configuration below ran the release candidate. The E2E suite has 59 cases
(25 single-sided, 19 two-sided, 14 RTL, 1 performance) plus the Maestro flows.

| Area | Configuration | What ran |
| --- | --- | --- |
| App stack | Expo SDK 54.0, React Native 0.81.5, React 19.1.0 | Example app and a clean app that installs the packed tarball |
| Architecture | New Architecture (Fabric), Hermes | All runs below |
| Android | API 34 x86_64 emulator (Pixel 6 profile) | 59 E2E cases, Robolectric unit tests |
| iOS | iOS 26.4 simulator (iPhone 17 Pro), Xcode 26.6 | 59 E2E cases, Maestro flows, Swift unit tests |
| Packaging | `npm pack` tarball in a clean Expo app | Install, type check, autolinking, release builds on both platforms |

## Not tested

- The legacy (Paper) architecture.
- Expo SDK below 54 and React Native below 0.81, even though the peer ranges allow them.
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
