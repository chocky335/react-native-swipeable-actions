# Changelog

All notable changes to this package are recorded here. GitHub release notes use
the entry for the matching version.

## Unreleased

## 1.0.0-rc.0 - 2026-10-17

First release candidate for 1.0.0. Install it with
`npm install react-native-swipeable-actions@next`. Rebuild the iOS and Android
apps after you upgrade. Read the [v1 migration guide](docs/migration-v1.md).

### BREAKING CHANGES

- The package requires the New Architecture (Fabric) on iOS and Android. The
  legacy architecture (Paper) is not supported. The iOS view does not compile on it.
- The minimum peer versions are now Expo SDK 54 (`expo >=54.0.0`), React Native
  0.81 (`react-native >=0.81.0`) and React 19.1 (`react >=19.1.0`).
- Removed `actions`, `actionsWidth` and `actionsPosition`. Pass explicit pairs:
  `rightActions` + `rightActionsWidth` and/or `leftActions` + `leftActionsWidth`
  ([#15](https://github.com/chocky335/react-native-swipeable-actions/issues/15)).
- Removed `SWIPE_DEFAULTS.ACTIONS_POSITION`. There is no default side.
- Removed `actionsWidth` and `actionsPosition` from the raw `SwipeableView` props.
- `SwipeableProps` is now a union type of valid side configurations, not an
  interface. Use `SwipeableProps & { ... }` for wrapper props.
- Every row uses one native engine. Rows migrated from the single-sided API take
  its behavior:
  - A drag toward a disabled side stays closed and does not start a swipe. The
    old wrong-direction rubber band is gone.
  - `onSwipeStateChange` follows the active side. Do not depend on the old
    callback cadence.
  - `close(false)` and `cancel()` also clear the cached open state for the key.
  - Cache restoration and width updates are not swipes. Do not use the swipe
    callbacks to detect them.
- `open()` with no side opens the right side if it is enabled, else the left side.

### Added

- Independent left and right actions on one row, each with its own width.
- `open(side)` and `Swipeable.open(key, side)`.
- `onLeftSwipeEnd` and `onRightSwipeEnd`. They run after `onSwipeEnd`.
- Opt-in `appearance="ios26"` iOS action motion, and the `hapticFeedback`
  prop for the iOS threshold haptic. Reduce Motion removes the motion scaling
  ([#19](https://github.com/chocky335/react-native-swipeable-actions/issues/19)).
- Type exports `SwipeSide`, `SwipeAppearance`, `SwipeableCommonProps`,
  `SwipeStartEvent`, and the aliases `TwoSidedSwipeableProps` and
  `SwipeableComponentProps`.

### Fixed

- Action alignment on the physical edge in RTL layouts.
- A recycled or rebound row no longer receives commands, callbacks or open state
  from its previous key.
- A drag that crosses the closed position no longer opens the opposite side.
- On Android, content replaced during a drag no longer keeps the drag offset.
- `Swipeable.closeAll()` now also closes rows that are not mounted (scrolled off
  or on a covered screen), like `Swipeable.close(key)`.
- `expo-modules-core` is no longer a peer dependency. A fresh `npm install`
  could pull a newer expo-modules-core than the app's Expo SDK uses. The app now
  gets the version its `expo` package brings.
- The shipped Jest mock (`jestSetup.js`) no longer calls `onSwipeStart` when a row
  mounts. Tests that relied on that call must fire the native event themselves,
  as the README shows.
- On Android, a swipe with no touch events for 5 seconds is now cancelled
  without an `onSwipeEnd`, and the rest of that touch is ignored.
- A cancelled swipe now reports the position where the row settles to
  `onProgress` and `onSwipeStateChange`, so a progress UI does not stay mid-drag.
- An `autoClose` row that a cancelled drag returns to open now waits
  `autoCloseTimeout` again and closes. Before, it stayed open.
- On iOS, a pan that has not passed `dragOffsetFromEdge` no longer stops a
  pending auto-close or a settling animation. That work and a props change also
  no longer swallow the pan, so the pan can still start a swipe, like on Android.

## 0.1.12 and earlier

Not recorded in this file. See the
[GitHub releases](https://github.com/chocky335/react-native-swipeable-actions/releases).
