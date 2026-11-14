# react-native-swipeable-actions

[![npm](https://img.shields.io/npm/v/react-native-swipeable-actions)](https://www.npmjs.com/package/react-native-swipeable-actions)
[![CI](https://github.com/chocky335/react-native-swipeable-actions/actions/workflows/ci.yml/badge.svg)](https://github.com/chocky335/react-native-swipeable-actions/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-swipeable-actions)](LICENSE)

Native swipeable rows for React Native. Gestures, springs and progress run in
Swift and Kotlin, so a busy JavaScript thread does not drop swipe frames. It is a
native alternative to `react-native-gesture-handler/Swipeable` and needs no
`react-native-reanimated`.

- Independent left and right actions on the same row, each with its own width
- Action content mounts on demand, on the first swipe or programmatic open
- Open state survives FlatList and FlashList recycling through `recyclingKey`
- Ref and static commands: open a chosen side, close, cancel, close all
- Auto-close for chat-style swipe-to-reply
- Opt-in iOS-style action motion and native iOS haptics
- Physical left/right sides that behave the same in RTL layouts

> Upgrading from 0.x? Version 1.0 replaces `actions`, `actionsWidth` and
> `actionsPosition` with explicit left/right props. Read the
> [migration guide](docs/migration-v1.md).

## Installation

```sh
npx expo install react-native-swipeable-actions
```

This is an [Expo module](https://docs.expo.dev/modules/overview/) with native code.

- Requirements: Expo SDK 54 or newer, React Native 0.81 or newer, React 19.1 or
  newer, and the New Architecture (Fabric). The legacy architecture (Paper) is
  not supported.
- Expo: use a [development build](https://docs.expo.dev/develop/development-builds/introduction/)
  or `npx expo run:ios` / `npx expo run:android`. Expo Go cannot load it.
- Bare React Native: set up Expo Modules first with `npx install-expo-modules@latest`,
  then run `pod install`.
- Rebuild the iOS and Android apps after you install or upgrade this package.
  A JavaScript reload or an OTA update cannot change the native code.

See [compatibility](#compatibility) for the configurations that were tested.

## Quick start

```tsx
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Swipeable, type SwipeableMethods } from "react-native-swipeable-actions";

export function MessageRow({ id, onArchive }: { id: string; onArchive: () => void }) {
  const row = useRef<SwipeableMethods>(null);

  return (
    <Swipeable
      ref={row}
      recyclingKey={id}
      rightActions={
        <Pressable
          onPress={() => {
            onArchive();
            row.current?.close();
          }}
          style={{ width: 88, height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#d33" }}
        >
          <Text style={{ color: "#fff" }}>Archive</Text>
        </Pressable>
      }
      rightActionsWidth={88}
    >
      <View style={{ minHeight: 64, padding: 16, backgroundColor: "#fff" }}>
        <Text>Swipe left to archive</Text>
      </View>
    </Swipeable>
  );
}
```

Each side is a pair: content plus its width in layout units.

- The width is the full reveal distance, including padding and gaps. The library
  does not measure action content.
- The action rail spans the row. Give the action content its own width and height.
- A width alone enables its side with an empty rail. Nothing shows behind the content.
- To turn a side off, omit its width. `null` or `false` content also turns the side
  off, with or without a width.
- A disabled side never falls back to the other side.

## Two-sided rows

```tsx
<Swipeable
  recyclingKey={item.id}
  leftActions={<ReplyAction />}
  leftActionsWidth={72}
  rightActions={<DeleteAndMoreActions />}
  rightActionsWidth={160}
  onLeftSwipeEnd={(state) => state === "open" && markRead(item.id)}
>
  <Message item={item} />
</Swipeable>
```

- Drag right to reveal `leftActions`. Drag left to reveal `rightActions`.
- One gesture stays on one side. A drag that crosses the closed position does not
  open the other side until the next gesture.
- Content and widths can change while the row is mounted.

## Lists and recycling

Give every row a stable, unique `recyclingKey`. The native view caches the open
side per key, so a recycled cell shows the correct state for its new item.

```tsx
import { FlashList } from "@shopify/flash-list";

<FlashList
  data={messages}
  renderItem={({ item }) => (
    <Swipeable recyclingKey={item.id} rightActions={<DeleteAction id={item.id} />} rightActionsWidth={80}>
      <MessageRow message={item} />
    </Swipeable>
  )}
/>;
```

- The key identifies the item, not its index or its current language.
- A row needs a `recyclingKey` if its open state must survive recycling or a
  screen change.
- If a cached side is now disabled, the row restores closed.
- If a side's width changed, the row restores at the new width.
- Rows do not close their siblings automatically. Call `Swipeable.closeAll()` or
  `Swipeable.close(key)` when your UI needs it.

## Swipe to reply

With `autoClose`, a completed swipe snaps back closed and reports
`onSwipeEnd("open")` once. The `"open"` state means the swipe passed the threshold.
It does not mean the row stays open.

`autoClose` applies to swipes only. A programmatic `open()` on an `autoClose` row
stays open and does not report `onSwipeEnd`.

```tsx
<Swipeable
  recyclingKey={message.id}
  leftActions={<ReplyIcon />}
  leftActionsWidth={60}
  autoClose
  threshold={0.6}
  onSwipeEnd={(state) => state === "open" && startReply(message)}
>
  <ChatBubble message={message} />
</Swipeable>
```

## Swipe to go back

Wrap a whole screen to slide it right with the finger. A full swipe goes back, and
nothing shows behind the screen. Give the left side a width as wide as the window and
no content.

```tsx
const { width } = useWindowDimensions();
const screen = useRef<SwipeableMethods>(null);
const key = useId();

<Swipeable
  ref={screen}
  recyclingKey={key}
  leftActionsWidth={width}
  isRTL={I18nManager.isRTL}
  dragOffsetFromEdge={20}
  onSwipeStart={() => hasUnsavedDraft() && screen.current?.cancel()}
  onSwipeEnd={(state) => {
    if (state !== "open") return;
    if (hasUnsavedDraft()) screen.current?.close();
    else navigation.goBack();
  }}
>
  <ChatScreen />
</Swipeable>
```

- `onSwipeStart` is an optional guard. `cancel()` closes the row at once, and the
  swipe does not complete.
- `onSwipeStart` reaches JavaScript asynchronously. If the swipe settles open before
  your `cancel()` runs, `onSwipeEnd("open")` has already been sent. A busy
  JavaScript thread makes this more likely. Check the guard again in `onSwipeEnd`,
  and call `close()` instead of navigating.
- `cancel()` and `close()` need a `recyclingKey`. Use a new key for each mount of the screen.
  Then a later mount does not restore the open state of a screen that you swiped away.
- If the navigator has its own back gesture on that screen, turn it off. For a
  native stack, set `gestureEnabled: false`.
- `isRTL={I18nManager.isRTL}` makes the screen slide left in a right-to-left layout.
  Leave it out if the swipe must go right in every layout.

The example app has a small reusable wrapper,
[`SwipeToGoBack`](https://github.com/chocky335/react-native-swipeable-actions/blob/main/example/components/SwipeToGoBack.tsx).

### A horizontal pager inside the screen

A horizontal pager or carousel inside the screen needs the same drag as the swipe.
On Android the row can take a drag in the swipe direction before the pager claims it.
The screen then moves and the page does not turn. Set `gestureInsets` to the area
that the pager covers. A touch that starts there goes to the pager. A touch anywhere
else still swipes the screen.

```tsx
<Swipeable
  recyclingKey={key}
  leftActionsWidth={width}
  gestureInsets={{ bottom: pagerHeight }}
>
  {/* A horizontal pager fills the bottom `pagerHeight` of this screen. */}
  <ChatScreen />
</Swipeable>
```

- Each inset is a distance in layout units (dp on Android, pt on iOS) from that edge
  of the row: `top`, `bottom`, `left`, `right`. An edge that you leave out has no band.
- The row reads the insets when a touch goes down. That touch keeps its answer until
  the finger lifts: the row does not track it, intercept it or cancel the touches of
  its children. If you change the insets during a touch, the next touch uses them.
- The insets apply while the row is closed and at rest. An open or moving row ignores
  them, so a swipe from any point can always close it.
- `open()`, `close()` and `cancel()` do not depend on the insets.

## Commands

```tsx
const row = useRef<SwipeableMethods>(null);

row.current?.open(); // Right if enabled, else left. No-op if neither is enabled.
row.current?.open("left"); // No-op if left is disabled. Never opens right instead.
row.current?.close(); // Animated.
row.current?.close(false); // Instant. Also clears the cached open state.
row.current?.cancel(); // Closes at once. A pending swipe does not complete.

Swipeable.open("message-42", "right");
Swipeable.close("message-42", false);
Swipeable.cancel("message-42");
Swipeable.closeAll();
```

Ref commands need a nonempty `recyclingKey` on the row. Numeric keys become strings,
so `Swipeable.close("7")` reaches the row with `recyclingKey={7}`.

## Accessibility

A swipe is not the only way to reach row actions. Users of screen readers and
switch control need a path without a swipe. Give the row content
`accessibilityActions`, and call the same business callbacks as the action buttons.

```tsx
<Swipeable
  recyclingKey={item.id}
  rightActions={<ArchiveButton onPress={() => archive(item.id)} />}
  rightActionsWidth={88}
>
  <Pressable
    onPress={() => openItem(item.id)}
    accessibilityActions={[{ name: "archive", label: "Archive" }]}
    onAccessibilityAction={(event) => {
      if (event.nativeEvent.actionName === "archive") archive(item.id);
    }}
  >
    <ItemRow item={item} />
  </Pressable>
</Swipeable>
```

- React Native gives these actions to VoiceOver and TalkBack as custom actions.
  This package has no screen reader tests.
- A closed row hides its action rails from accessibility. The content actions are
  then the only path to the row actions.
- The action widths are yours. The library does not measure action content. With
  a large text size, a label can need more width than you declared. Make the
  width bigger as the font scale grows (`useWindowDimensions().fontScale`), or use
  short labels or icons with an `accessibilityLabel`.

The example list row uses the same pattern.

## RTL

By default `left` and `right` are physical edges in every layout direction. React
Native's global RTL setting does not swap action content, widths, commands or side
callbacks.

To mirror a row, pass `isRTL`. Write the row once for a left-to-right layout:

```tsx
<Swipeable
  isRTL={I18nManager.isRTL}
  leftActions={<ReplyAction />}
  leftActionsWidth={72}
  rightActions={<DeleteAction />}
  rightActionsWidth={88}
  onRightSwipeEnd={(state) => state === "open" && remove(item.id)}
>
  <Message item={item} />
</Swipeable>
```

With `isRTL` on, every side name refers to the opposite physical edge:

- `rightActions` and `rightActionsWidth` sit on the left edge, and a drag to the
  right reveals them. The `left` pair sits on the right edge.
- `open("right")` and `Swipeable.open(key, "right")` open the `rightActions`.
  `open()` with no side still prefers `rightActions`, then `leftActions`.
- `onRightSwipeEnd` runs for the `rightActions`, and `onLeftSwipeEnd` for the
  `leftActions`.

`isRTL` is a plain boolean. The library does not read `I18nManager` for it, so an app
that already maps its sides for RTL is not mirrored twice. Any other flag works too,
for example a chat that mirrors only incoming messages.

- `isRTL` moves whole sides. It does not reorder the buttons inside your action
  content. React Native lays that content out in the app's layout direction.
- Each rail keeps its content against its own physical edge in both layout
  directions (fixed in 1.0.0), so mirrored actions still start at the outer edge.
- `isRTL` also swaps the `left` and `right` values of `gestureInsets`.
- The raw `SwipeableView` props stay physical.
- A static command mirrors its side only while the `isRTL` row is mounted.
- Close open rows before you swap which actions sit on which physical side.
- A translated label can need a new width. Update the width with the label.
- A change to React Native's global RTL setting (`I18nManager.forceRTL`) needs an
  app restart.

## iOS appearance and haptics

```tsx
<Swipeable appearance="ios26" rightActions={actions} rightActionsWidth={144}>
  {content}
</Swipeable>
```

- `appearance="ios26"` adds iOS-style action motion. The default is `"default"`.
  The OS version does not turn it on. It does not need the iOS 26 SDK. It is not
  Apple's system swipe control.
- `hapticFeedback` controls the native threshold haptic on iOS. If you omit it,
  it follows the preset: on for `ios26`, off for `default`.
- Reduce Motion removes the action scaling. It does not change the haptic setting.
  The row still slides open and closed with its normal animation.
- Both options have no effect on Android.
- Rounded or inset buttons and multiple actions are your own action content.

## API

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | required | Row content. |
| `leftActions` / `rightActions` | `ReactNode` | - | Action content for that side. Optional when the side has a width. `null`/`false` disables the side. |
| `leftActionsWidth` / `rightActionsWidth` | `number` | - | Enables its side. Finite and positive. At least one side is required. |
| `isRTL` | `boolean` | `false` | Mirrors the sides, the commands and the side callbacks. See [RTL](#rtl). |
| `recyclingKey` | `string \| number` | - | Stable item key. Required for ref commands, static commands and list state restoration. |
| `threshold` | `number` | `0.4` | Fraction (0-1) of the active side's width a release must pass to open. |
| `friction` | `number` | `1` | Drag damping (0-1). Lower values add resistance. |
| `dragOffsetFromEdge` | `number` | `0` | Horizontal distance before the swipe starts. |
| `gestureEnabled` | `boolean` | `true` | Turns the gesture off. Commands still work. |
| `gestureInsets` | `{ top?, bottom?, left?, right?: number }` | - | Edge bands where a touch does not start a swipe and goes to the children. See [a horizontal pager inside the screen](#a-horizontal-pager-inside-the-screen). |
| `autoClose` | `boolean` | `false` | Snap back after a completed swipe. |
| `autoCloseTimeout` | `number` | `0` | Delay in ms before the auto-close. |
| `appearance` | `'default' \| 'ios26'` | `'default'` | iOS action motion preset. |
| `hapticFeedback` | `boolean` | from `appearance` | iOS threshold haptic. |
| `style` | `StyleProp<ViewStyle>` | - | Container style. |
| `testID` | `string` | - | Test identifier. |

### Callbacks

| Callback | Type | When |
| --- | --- | --- |
| `onSwipeStart` | `() => void` | A swipe gesture starts. |
| `onSwipeStateChange` | `(state: 'open' \| 'closed') => void` | The release target crosses the threshold during a drag. |
| `onSwipeEnd` | `(state: 'open' \| 'closed') => void` | A swipe or a command animation settles. |
| `onLeftSwipeEnd` / `onRightSwipeEnd` | `(state: 'open' \| 'closed') => void` | Same as `onSwipeEnd`, for that side only. Runs after `onSwipeEnd`. |
| `onProgress` | `(progress: number) => void` | Every frame of movement. `0` is closed, `1` is fully open. |

If you handle the same action in `onSwipeEnd` and in a side callback, it runs twice.
Do not use these callbacks to detect cache restoration or width updates. Those are
not swipes.

### Methods

| Ref method | Static method | Description |
| --- | --- | --- |
| `open(side?)` | `Swipeable.open(key, side?)` | Open a side by its prop name. Without a side: right if enabled, else left. |
| `close(animated = true)` | `Swipeable.close(key, animated = true)` | Close the row. |
| `cancel()` | `Swipeable.cancel(key)` | Close at once. A gesture in progress or a pending open does not complete. |
| - | `Swipeable.closeAll(animated = true)` | Close all rows, including rows that are not mounted (scrolled off or on a covered screen). Those rows come back closed. |

### Types

```ts
import type {
  SwipeableProps, // Canonical props type
  SwipeableCommonProps, // Props that every side configuration shares
  SwipeableMethods, // Ref methods
  SwipeableStatic, // Static methods
  SwipeSide, // 'left' | 'right'
  SwipeAppearance, // 'default' | 'ios26'
  GestureInsets, // { top?, bottom?, left?, right? } in layout units
} from "react-native-swipeable-actions";
```

`SwipeableProps` is a union of valid side configurations. To add wrapper props,
use an intersection instead of `interface extends`:

```ts
type MessageSwipeProps = SwipeableProps & { itemId: string };
```

`TwoSidedSwipeableProps` and `SwipeableComponentProps` are aliases of `SwipeableProps`.

## Testing with Jest

The package ships a Jest mock for the native view:

```js
// jest.config.js
module.exports = {
  setupFiles: ["react-native-swipeable-actions/jestSetup.js"],
};
```

The package ships TypeScript source, so keep it in your `transformIgnorePatterns`
allowlist, as you do for other Expo modules.

- The mock renders both action rails on mount, so your tests can find action
  content.
- A mount calls none of your callbacks. The mock never starts a swipe by itself.
- The ref and static commands are `jest.fn()` mocks. They do not move the row or
  send events.
- To test a callback, fire a native-shaped event on the row's `testID`. Put the
  row's `recyclingKey` (as a string) in `nativeEvent`. Leave it out for a row
  without a key.

```tsx
import { fireEvent, screen } from "@testing-library/react-native";

const row = screen.getByTestId("message-42");
fireEvent(row, "swipeStart", { nativeEvent: { recyclingKey: "42", side: "right" } });
fireEvent(row, "swipeEnd", {
  nativeEvent: { state: "open", side: "right", recyclingKey: "42" },
});
// onSwipeStart() ran once, then onSwipeEnd("open") and onRightSwipeEnd("open").
```

The other native events are `swipeStateChange` (`{ state, side }`) and
`swipeProgress` (`{ progress, translationX, side }`).

The `side` in a native event is the physical side. For a row with `isRTL`, a native
`side: "left"` runs `onRightSwipeEnd`.

## Compatibility

| | Tested for 1.0 |
| --- | --- |
| Expo / React Native / React | Expo SDK 54, React Native 0.81, React 19.1 |
| Architecture | New Architecture (Fabric) |
| iOS | iOS Simulator 26, built with Xcode 26 |
| Android | API 34 emulator |

The package requires the New Architecture. The legacy architecture (Paper) is not
supported. The peer ranges (`expo >=54`, `react-native >=0.81`, `react >=19.1`) and
the minimum targets (iOS 13.4, Android API 23) are what the package declares. They
are not a tested matrix. [docs/support.md](docs/support.md) lists what was tested
and what was not.

An app built with the iOS 27 SDK (Xcode 27) stops at launch on iOS 27 if it does not
adopt the UIScene lifecycle. iOS sets this requirement for the app. The Expo SDK 54
app template does not meet it, and this package does not affect it. The example app adopts the UIScene lifecycle. Built with Xcode 27,
it launched on a physical iPhone with iOS 27.0.1. Only the launch was checked.

## Performance

The list demo in `example/` with 100 rows, measured with 1.2.1 in a Release build.
FlashList's `useBenchmark` scrolls the list and counts JavaScript frames per second.
No row is swiped. Each value is the average of 3 runs on one install, with the screen on.

<table>
<tr><th>react-native-gesture-handler/Swipeable</th><th>react-native-swipeable-actions</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/6d7cf1e6-c719-4044-8b47-205e94a38d10

</td>
<td>

https://github.com/user-attachments/assets/f59ef788-caf4-4985-93bc-8d098122fe1a

</td>
</tr>
<tr><td align="center">Reanimated</td><td align="center">Native</td></tr>
<tr><td colspan="2" align="center">Pixel 8 Pro, Android 17, 120 Hz</td></tr>
<tr><td align="center"><b>Avg 107.0</b> FPS (min 79.9 / max 113.4)</td><td align="center"><b>Avg 113.0</b> FPS (min 107.6 / max 117.0)</td></tr>
<tr><td colspan="2" align="center">Xiaomi Mi 11 Lite, Android 13, 90 Hz</td></tr>
<tr><td align="center"><b>Avg 50.9</b> FPS (min 27.3 / max 61.6)</td><td align="center"><b>Avg 83.9</b> FPS (min 65.2 / max 88.3)</td></tr>
</table>

## How it works

`<Swipeable>` renders one native view with three children: the left action rail,
the right action rail and your content. A pan recognizer on iOS and a touch
handler on Android move the content with spring animations and send progress
events to JavaScript. The native side keeps a per-key cache of the open side for
recycled list cells. Action rails mount in React only when a side is about to show.

## Contributing

The `example/` app demonstrates every option and runs the E2E suites
(WebdriverIO + Appium, plus Maestro). See [e2e/README.md](https://github.com/chocky335/react-native-swipeable-actions/blob/main/e2e/README.md)
and the [release checklist](https://github.com/chocky335/react-native-swipeable-actions/blob/main/docs/releasing.md).

```sh
npm test            # Jest
npm run test:ios    # Swift unit tests: helpers and state logic, no UIKit
npm run test:android
```

## License

[MIT](LICENSE)
