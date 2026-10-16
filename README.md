# react-native-swipeable-actions

A high-performance native swipeable row component for React Native. Native alternative to `react-native-gesture-handler/Swipeable` - no `react-native-reanimated` required.

This document describes the **upcoming 1.0.0 API**, not a published release. The former
`actions`, `actionsWidth`, and `actionsPosition` props are removed; see the migration guide below.

## Features

- Pure native gestures - no JS thread blocking
- 60fps spring animations on both iOS and Android
- No `react-native-reanimated` dependency
- Built-in FlashList/virtualized list support via `recyclingKey`
- AutoClose pattern for chat-style swipe-to-reply
- Lazy action rendering for optimal performance
- Independent physical left/right actions, widths, and completion callbacks
- Opt-in iOS-inspired action motion and native iOS haptics

## Performance

Benchmark comparison on Android 16, Pixel 8 Pro, GrapheneOS — List Demo with 100 items:

<table>
<tr>
<th>react-native-gesture-handler/Swipeable</th>
<th>react-native-swipeable-actions</th>
</tr>
<tr>
<td>
  
https://github.com/user-attachments/assets/6d7cf1e6-c719-4044-8b47-205e94a38d10

</td>
<td>

https://github.com/user-attachments/assets/f59ef788-caf4-4985-93bc-8d098122fe1a

</td></tr>
<tr>
<td align="center">Reanimated</td>
<td align="center">Pure native</td>
</tr>
<tr>
<td align="center"><b>Avg 60.9</b> FPS (Min: 56.7 / Max: 65.7)</td>
<td align="center"><b>Avg 116.8</b> FPS (Min: 109.9 / Max: 120.3)</td>
</tr>
</table>

> Videos not loading? View on [GitHub](https://github.com/chocky335/react-native-swipeable-actions#performance)

## Installation

```bash
npm install react-native-swipeable-actions
```

This package includes native code. Rebuild the application's iOS and Android targets after
installing or updating it, including when migrating to 1.0.0 or adopting the appearance preset.
Reloading JavaScript or sending an OTA update cannot add the new native implementation to an
old binary. Use an Expo development build or your application's native build workflow.

### Peer Dependencies

```json
{
  "expo": ">=50.0.0",
  "expo-modules-core": ">=1.0.0",
  "react": ">=18.0.0",
  "react-native": ">=0.73.0"
}
```

## Basic Usage

```tsx
import { Swipeable, SwipeableMethods } from "react-native-swipeable-actions";
import { useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";

function DeleteAction({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.deleteAction}>
      <Text style={styles.actionText}>Delete</Text>
    </TouchableOpacity>
  );
}

function MyRow() {
  const swipeableRef = useRef<SwipeableMethods>(null);

  return (
    <Swipeable
      ref={swipeableRef}
      recyclingKey="my-row"
      rightActions={<DeleteAction onPress={() => console.log("Delete!")} />}
      rightActionsWidth={80}
      onSwipeEnd={(state) => console.log("Swipe ended:", state)}
    >
      <View style={styles.row}>
        <Text>Swipe me left</Text>
      </View>
    </Swipeable>
  );
}
```

## Migrating to 1.0.0

Use the same component with explicit physical-side content/width pairs:

| Previous configuration | 1.0.0 configuration |
| --- | --- |
| Mixed legacy fallback and explicit props | Resolve content in the caller and pass only explicit pairs |

There is no legacy fallback or separate single-side behavior. Omit the unused pair, or
disable its content with `null`/`false` without a width. Callback argument lists and ref/static
method signatures remain unchanged. No-argument `open()` selects enabled right, otherwise
enabled left; it does nothing when neither edge is enabled.

Single-side rows now adopt the same behavior as two-sided rows. Drags toward a disabled
edge stay closed without starting a swipe lifecycle, rather than using legacy wrong-direction
rubber-banding. State callbacks follow the active, latched edge. Instant close updates the
closed cache, and restoring cached state is not a new swipe completion. Do not depend on
legacy incidental state/completion callback sequences during closing or restoration.
Rebuild the native app; this is not a JavaScript-only upgrade.

Implementation detail: all rows share stable left-action, right-action, and content slots;
action subtrees remain lazy. That native child layout and internal side/key event metadata
are not additional consumer props or arguments to the component's public callbacks.
The observable migration changes are the removed props, default-open selection, disabled-edge
handling, and state/close/cache behavior described above, not the number of native children.

## Independent Left and Right Actions

```tsx
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Swipeable,
  type SwipeableMethods,
} from "react-native-swipeable-actions";

function TwoSidedRow() {
  const row = useRef<SwipeableMethods>(null);

  return (
    <Swipeable
      ref={row}
      recyclingKey="message-1"
      leftActions={
        <Pressable onPress={() => console.log("Pin")}>
          <Text>Pin</Text>
        </Pressable>
      }
      leftActionsWidth={80}
      rightActions={
        <Pressable onPress={() => console.log("Delete")}>
          <Text>Delete</Text>
        </Pressable>
      }
      rightActionsWidth={120}
      onLeftSwipeEnd={(state) => console.log("Left completed:", state)}
      onRightSwipeEnd={(state) => console.log("Right completed:", state)}
    >
      <View>
        <Text>Swipe either way</Text>
      </View>
    </Swipeable>
  );
}
```

Sides name **physical revealed edges**: dragging right reveals `leftActions`; dragging left
reveals `rightActions`. RTL does not swap them. Each gesture latches one edge. When closing
through zero, the row stops closed; opening the opposite edge requires a new gesture.

Widths are independent, finite positive values in React Native layout units, including all
action padding and spacing. Content is not measured automatically. Each enabled explicit
action node needs its matching width. Action children mount lazily when needed by a gesture,
a programmatic open, or restored state. An explicit first open works before any drag.

### Explicit action configuration

| Input on an edge | Resolution |
| --- | --- |
| Complete content and finite positive width | Enables that physical edge |
| Content omitted, `undefined`, `null`, or `false` | Disables the edge; no fallback |
| Content with missing, nonfinite, zero, or negative width | Warns in development and disables the edge |
| Width without content | Warns in development and does not enable the edge |

Numeric `0` is valid React action content, not a disabling value. With neither edge enabled,
the row remains closed and open gestures/commands have no effect. Supply an explicit disabled
configuration, such as `leftActions={null} rightActions={false}`, for a fully disabled row.

### Completion and commands

The aggregate `onSwipeEnd(state)` runs once, followed by the matching optional
`onLeftSwipeEnd(state)` or `onRightSwipeEnd(state)`. The other side callback does not run.
Aggregate callbacks keep their original argument lists. Side callbacks do not press buttons
or automatically execute actions.

With `autoClose`, a successful gesture returns visually closed and then reports
`onSwipeEnd('open')` and the triggering side's end callback with `'open'`. Here, `'open'`
reports the completed swipe intent, not the final resting position. Use action `onPress`
for button taps, or the appropriate side callback for swipe-to-reply behavior.

```tsx
row.current?.open("left");
row.current?.open("right");
Swipeable.open("message-1", "left");
Swipeable.open("message-1", "right");
```

All ref commands also require a nonempty `recyclingKey`; finite numeric keys are normalized
to strings, so static commands use that string (for example, `42` becomes `'42'`).
Without a usable key, ref commands have no effect and warn in development. An explicit disabled-edge open is a
no-op and never opens the other edge. Opening the opposite enabled edge programmatically
first closes the current edge, then opens the requested edge, reporting each side's completion.

For `open()` / `Swipeable.open(key)` without a side, enabled right wins; otherwise enabled
left wins. With neither enabled, the command has no effect.

## Optional iOS-Inspired Appearance and Feedback

Appearance is additive to the breaking explicit-only 1.0.0 API described above,
not a compatibility layer for removed props or the old single-side engine.

`appearance="ios26"` explicitly opts into native iOS action-rail entry/pop motion. It does
not automatically activate based on the OS version. The default appearance preserves the
existing presentation. This is an iOS-inspired preset, not Apple's Mail/Notes control,
exact system-control parity, or Liquid Glass. It adds no blur/material dependency and
does not require the iOS 26 SDK.

`hapticFeedback` controls native iOS threshold feedback:

| Value   | Behavior                                                          |
| ------- | ----------------------------------------------------------------- |
| Omitted | Enabled with the explicit `ios26` preset; disabled with `default` |
| `true`  | Enables threshold feedback on iOS with either appearance          |
| `false` | Disables feedback with either appearance                          |

The effective iOS value is `hapticFeedback ?? (appearance === 'ios26')`. The example's
**Auto** setting omits the prop; `'auto'` is not a public API value. These props work
with either a single explicit action side or both sides; the removed legacy props are not supported.

Feedback is one light impact at the first opening-threshold crossing per physical gesture,
not repeated crossings, programmatic commands, recycling, or auto-close. No JavaScript
haptics call is needed. iOS Reduce Motion suppresses nonessential scale/pop, including
when the setting changes while mounted, while retaining swiping and the user's haptic
preference. It does not disable the row's normal translation or open/close animations.
On Android, both props retain the existing native motion and add no haptics.

The preset animates the action rail; rounded corners, colors, and inset buttons remain
caller-owned React content. For example, this recipe gives the right edge two 48-unit-wide
targets inside a total 120-unit reveal (`8 + 48 + 8 + 48 + 8`):

```tsx
const leftWidth = 80
const rightWidth = 120
const rail = { height: '100%' as const, flexDirection: 'row' as const, padding: 8, gap: 8 }
const leftRail = { ...rail, width: leftWidth }
const rightRail = { ...rail, width: rightWidth }
const button = {
  flex: 1, minWidth: 44, minHeight: 44, borderRadius: 16,
  alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: '#0A84FF'
}

<Swipeable
  recyclingKey="rounded-message"
  appearance="ios26"
  leftActions={
    <View style={leftRail}>
      <Pressable style={button} accessibilityLabel="Pin message" onPress={pin}>
        <Text>Pin</Text>
      </Pressable>
    </View>
  }
  leftActionsWidth={leftWidth}
  rightActions={
    <View style={rightRail}>
      <Pressable style={button} accessibilityLabel="Delete message" onPress={remove}>
        <Text>Del</Text>
      </Pressable>
      <Pressable style={button} accessibilityLabel="More actions" onPress={more}>
        <Text>...</Text>
      </Pressable>
    </View>
  }
  rightActionsWidth={rightWidth}
>
  <MessageRow />
</Swipeable>
```

Native action slots span the full row bounds. Give each caller-owned
rail an explicit width matching its reveal width and `height: '100%'`; using `flex: 1` on the
rail would spread its children across the full row. Keep `flex: 1` on the individual buttons
so they divide the space inside the explicitly sized rail. The 120-unit right rail contains
two 48-unit targets, 16 units of outer padding, and an 8-unit gap.

Keep labels short or increase widths for larger text; allow row height to grow. The example
offers one/multiple actions, optional rounded/inset styling, light/dark row surroundings,
and separate appearance/haptic controls. These visual choices do not change the single-side demos.

## Props

| Prop                                     | Type                   | Default                   | Description                                                                                                  |
| ---------------------------------------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `children`                               | `ReactNode`            | required                  | Row content                                                                                                  |
| `leftActions` / `rightActions`           | `ReactNode`            | -                         | Explicit physical-edge content; `null`/`false` disables the edge                                             |
| `leftActionsWidth` / `rightActionsWidth` | `number`               | -                         | Finite positive total reveal width for the corresponding explicit content                                    |
| `friction`                               | `number`               | `1`                       | Drag damping factor (0-1). Lower = more resistance                                                           |
| `threshold`                              | `number`               | `0.4`                     | Snap threshold as a fraction (0-1) of the active edge's explicit width |
| `gestureEnabled`                         | `boolean`              | `true`                    | Enables or disables the swipe gesture                                                                        |
| `dragOffsetFromEdge`                     | `number`               | `0`                       | Minimum drag distance before gesture starts                                                                  |
| `autoClose`                              | `boolean`              | `false`                   | Auto-close after swipe release (for swipe-to-reply)                                                          |
| `autoCloseTimeout`                       | `number`               | `0`                       | Delay in ms before auto-closing                                                                              |
| `appearance`                             | `'default' \| 'ios26'` | `'default'`               | Opt-in native iOS action motion; existing presentation on Android                                            |
| `hapticFeedback`                         | `boolean`              | preset-dependent          | Native iOS threshold feedback; no added feedback on Android                                                  |
| `recyclingKey`                           | `string \| number`     | -                         | Unique key for FlashList/recycling support                                                                   |
| `style`                                  | `StyleProp<ViewStyle>` | -                         | Container style                                                                                              |
| `testID`                                 | `string`               | -                         | Test ID for e2e testing                                                                                      |

## Callbacks

| Callback                             | Type                                  | Description                                                              |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------ |
| `onSwipeStart`                       | `() => void`                          | Called when swipe gesture begins                                         |
| `onSwipeStateChange`                 | `(state: 'open' \| 'closed') => void` | State/threshold transitions before completion; may occur during dragging |
| `onSwipeEnd`                         | `(state: 'open' \| 'closed') => void` | Called when animation completes                                          |
| `onLeftSwipeEnd` / `onRightSwipeEnd` | `(state: 'open' \| 'closed') => void` | Matching physical edge's completion, after the aggregate end callback    |
| `onProgress`                         | `(progress: number) => void`          | Called on each frame (0 = closed, 1 = fully open)                        |

## Ref Methods

Access via ref:

```tsx
const swipeableRef = useRef<SwipeableMethods>(null);

// Close the row (with optional animation)
swipeableRef.current?.close(); // animated
swipeableRef.current?.close(false); // instant

// Open the row
swipeableRef.current?.open();
swipeableRef.current?.open("left");
swipeableRef.current?.open("right");

// Cancel an in-flight gesture and snap back to closed.
// Use from `onSwipeStart` to abort a swipe before it can complete,
// e.g. when the parent screen has unsaved state and wants to show a
// confirm dialog instead of letting the swipe-to-pop proceed.
swipeableRef.current?.cancel();
```

## Static Methods

Control swipeables globally by their `recyclingKey`:

```tsx
import { Swipeable } from "react-native-swipeable-actions";

// Open a specific row
Swipeable.open("row-1");
Swipeable.open("row-1", "left");
Swipeable.open("row-1", "right");

// Close a specific row
Swipeable.close("row-1"); // animated
Swipeable.close("row-1", false); // instant

// Close all open rows
Swipeable.closeAll(); // animated
Swipeable.closeAll(false); // instant

// Cancel an in-flight gesture on a specific row
Swipeable.cancel("row-1");
```

## AutoClose Pattern (Swipe-to-Reply)

For chat-style swipe-to-reply where the row should automatically close:

```tsx
<Swipeable
  rightActions={<ReplyIndicator />}
  rightActionsWidth={60}
  autoClose={true}
  threshold={0.6}
  onSwipeEnd={(state) => {
    if (state === "open") {
      // Trigger reply action
      onReply(message);
    }
  }}
>
  <ChatMessage message={message} />
</Swipeable>
```

## FlashList Integration

For virtualized lists, use `recyclingKey` to persist swipe state across recycling:

All rows restore the cached physical edge using its current width. Rebinding a cell
to another key restores that key's state and action content. Removing/disabling the cached
edge restores closed rather than opening its opposite. Changing an enabled edge's positive
width updates its open reveal distance. Use stable, unique item keys in FlatList and FlashList.

```tsx
import { FlashList } from "@shopify/flash-list";

function MessageList({ messages }) {
  return (
    <FlashList
      data={messages}
      renderItem={({ item }) => (
        <Swipeable
          recyclingKey={item.id}
          rightActions={<DeleteAction />}
          rightActionsWidth={80}
        >
          <MessageRow message={item} />
        </Swipeable>
      )}
      estimatedItemSize={60}
    />
  );
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  JS Layer (React)                                           │
│  ┌─────────────────┐  ┌──────────────────────────────────┐ │
│  │ <Swipeable>     │  │ Actions (ReactNode)              │ │
│  │  - renderActions│──│  - Rendered lazily on first swipe│ │
│  │  - ref methods  │  │  - Any React components          │ │
│  └────────┬────────┘  └──────────────────────────────────┘ │
└───────────│─────────────────────────────────────────────────┘
            │ Expo Modules Bridge
┌───────────▼─────────────────────────────────────────────────┐
│  Native Layer (Kotlin/Swift)                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ SwipeableView                                           ││
│  │  - UIPanGestureRecognizer (iOS) / OnTouchListener (And) ││
│  │  - Spring animations (UIView.animate / DynamicAnimation)││
│  │  - Progress events @ 60fps (CADisplayLink / Choreograph)││
│  │  - LRU cache for recycling state persistence            ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- Gestures handled entirely in native code for 60fps performance
- Actions rendered lazily on demand, including programmatic opens and keyed restoration
- Recycling key enables state persistence in virtualized lists
- No SharedValue dependency - progress synced via native events

## Platform Support

| Platform | Version |
| -------- | ------- |
| iOS      | 13.4+   |
| Android  | API 23+ |

## RTL and Language Changes

`leftActions` and `rightActions` always name physical edges, including in RTL:
dragging right reveals the left actions, and dragging left reveals the right actions.
Action slots compensate for the app's `I18nManager.isRTL` alignment.
The library does not automatically exchange action content, widths, or callbacks.

When only the translation language changes, rerender the action content and update its
explicit width if the translated label needs more space. The row's recycling key should
continue to identify the same item, not the language. If your application maps logical
start/end actions to different physical edges, close rows before changing that mapping.

Changing React Native's global RTL settings requires an application restart; toggling
translated strings alone does not change native layout direction. See
[React Native I18nManager](https://reactnative.dev/docs/i18nmanager).
Per-row direction overrides are not part of the physical-edge API contract.

## TypeScript

Full TypeScript support with exported types:

```tsx
import {
  Swipeable,
  SwipeableProps,
  TwoSidedSwipeableProps,
  SwipeableComponentProps,
  SwipeSide,
  SwipeAppearance,
  SwipeableMethods,
  SwipeableStatic,
  SwipeProgressEvent,
  SwipeStateEvent,
} from "react-native-swipeable-actions";
```

`SwipeableProps` is the canonical explicit-side type. `TwoSidedSwipeableProps` and
`SwipeableComponentProps` are aliases of that same type, not a union accepting the removed
props. `SwipeSide` is `'left' | 'right'`; `SwipeAppearance` is `'default' | 'ios26'`.
Migrate wrapper props and mocks to explicit pairs.
Use a type intersection such as `type RowProps = SwipeableProps & { rowID: string }`
instead of extending the former legacy interface.

## Testing

Jest mock is included for testing components that use Swipeable:

```js
// jest.config.js
import "react-native-swipeable-actions/jestSetup.js";
```

### Two-sided example and device tests

In the example app's config panel, select **Two-sided**. Its own scrollable controls start
with ref/static left/right opens, no-argument open, animated/instant close, and closeAll.
Options include each edge, gestures, auto-close, independent 80/120 widths, alternate explicit content,
appearance, haptics, and caller styling. Language controls also offer an explicit right-only mode.
Recycling controls switch FlatList/FlashList, rebind
slot 0 from key 0 to 100 and back, swap the first two rows, and detach/attach the list.
Commands target the current first row. Each row shows action counters and aggregate/side
completion counts plus the last side/state. Hide controls to leave more space for rows.

After rebuilding the native application, run a complete platform suite from `e2e/`.
Both platform scripts run all single-side regression, two-sided, RTL, and benchmark specs without filters:

```sh
npm run test:android
npm run test:ios
```

For focused diagnostics only, the two-sided spec can be selected explicitly:

```sh
npx wdio run wdio.conf.ts --spec specs/two-sided.spec.ts
ANDROID_UDID=<device-id> ANDROID_APP_PATH=/path/to/app-release.apk \
  npx wdio run wdio.conf.ts --spec specs/two-sided.spec.ts
IOS_APP_PATH=/path/to/SwipeableDemo.app IOS_UDID=<simulator-or-device-id> \
  npx wdio run wdio.ios.conf.ts --spec specs/two-sided.spec.ts
```

The Android config defaults to the example release APK at its configured build output path.
Optionally set `ANDROID_APP_PATH` to another APK and `ANDROID_UDID` to select a connected
device or emulator; omit them to use the configuration's defaults.
The spec observes rendered action presses, native position, and callback counters for first
programmatic opens, disabled edges, cross-zero latching, auto-close, width changes,
rebind/reorder, and closeAll after attachment with both lists. It also checks that the opt-in
appearance keeps functional action targets and geometry on either platform. These are test
scenarios, not a claim that native/device tests have been run. Run the existing regression
spec as well; manually check larger text, RTL, reduced motion, interruption, and iOS visuals.
Judge haptic feel on a physical iPhone; simulator/type checks cannot establish it.

## License

MIT
