# react-native-swipeable-actions

[![npm](https://img.shields.io/npm/v/react-native-swipeable-actions)](https://www.npmjs.com/package/react-native-swipeable-actions)
[![CI](https://github.com/chocky335/react-native-swipeable-actions/actions/workflows/ci.yml/badge.svg)](https://github.com/chocky335/react-native-swipeable-actions/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-swipeable-actions)](https://www.npmjs.com/package/react-native-swipeable-actions)

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
- Omit a side, or pass `null` or `false`, to disable it. Omit its width too.
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
nothing shows behind the screen. Give the left side empty content as wide as the
window. Do not pass `null`, because `null` disables the side.

```tsx
const { width } = useWindowDimensions();
const screen = useRef<SwipeableMethods>(null);
const key = useId();

<Swipeable
  ref={screen}
  recyclingKey={key}
  leftActions={<View />}
  leftActionsWidth={width}
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

The example app has a small reusable wrapper,
[`SwipeToGoBack`](https://github.com/chocky335/react-native-swipeable-actions/blob/main/example/components/SwipeToGoBack.tsx).

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

## RTL

`left` and `right` are physical edges in every layout direction. RTL does not swap
action content, widths, commands or side callbacks. If your app thinks in logical
start/end actions, map them to left/right yourself.

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
- Both options have no effect on Android.
- Rounded or inset buttons and multiple actions are your own action content.

## API

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | required | Row content. |
| `leftActions` / `rightActions` | `ReactNode` | - | Action content for that physical side. `null`/`false` disables the side. At least one side is required. |
| `leftActionsWidth` / `rightActionsWidth` | `number` | - | Required with its content. Finite and positive. |
| `recyclingKey` | `string \| number` | - | Stable item key. Required for ref commands, static commands and list state restoration. |
| `threshold` | `number` | `0.4` | Fraction (0-1) of the active side's width a release must pass to open. |
| `friction` | `number` | `1` | Drag damping (0-1). Lower values add resistance. |
| `dragOffsetFromEdge` | `number` | `0` | Horizontal distance before the swipe starts. |
| `gestureEnabled` | `boolean` | `true` | Turns the gesture off. Commands still work. |
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
| `open(side?)` | `Swipeable.open(key, side?)` | Open a side. Without a side: right if enabled, else left. |
| `close(animated = true)` | `Swipeable.close(key, animated = true)` | Close the row. |
| `cancel()` | `Swipeable.cancel(key)` | Cancel the current gesture or pending open. |
| - | `Swipeable.closeAll(animated = true)` | Close all rows, including rows that are not mounted (scrolled off or on a covered screen). Those rows come back closed. |

### Types

```ts
import type {
  SwipeableProps, // Canonical props type
  SwipeableMethods, // Ref methods
  SwipeableStatic, // Static methods
  SwipeSide, // 'left' | 'right'
  SwipeAppearance, // 'default' | 'ios26'
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

## Compatibility

| | Tested for 1.0 |
| --- | --- |
| Expo / React Native / React | Expo SDK 54, React Native 0.81, React 19.1 |
| Architecture | New Architecture (Fabric) |
| iOS | iOS Simulator 26, built with Xcode 26 |
| Android | API 34 emulator |

The peer ranges (`expo >=50`, `react-native >=0.73`) and the minimum targets
(iOS 13.4, Android API 23) are what the package declares. They are not a tested
matrix. [docs/support.md](docs/support.md) lists what was tested and what was not.

## Performance

Android 16, Pixel 8 Pro, list demo with 100 items. Measured with 0.1.x.

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
<tr><td align="center"><b>Avg 60.9</b> FPS (min 56.7 / max 65.7)</td><td align="center"><b>Avg 116.8</b> FPS (min 109.9 / max 120.3)</td></tr>
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
npm run test:ios    # Swift unit tests
npm run test:android
```

## License

MIT
