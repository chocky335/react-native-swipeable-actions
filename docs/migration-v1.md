# Migrating to v1

The component name stays `Swipeable`. All rows now use explicit physical-side
content/width pairs and one native engine. Rebuild the native app after upgrading.
Do not mix v1 JavaScript with an older native binary.

## Before you install

- v1 requires the New Architecture (Fabric) on iOS and Android. The legacy
  architecture (Paper) is not supported. If your app still uses it, stay on 0.x.
- v1 requires Expo SDK 54 or newer, React Native 0.81 or newer and React 19.1 or
  newer. Upgrade the app first, then install v1.
- Install it with `npx expo install react-native-swipeable-actions`, then rebuild
  the iOS and Android apps.

## At a glance

| Kind | 0.x | 1.0 |
| --- | --- | --- |
| Removed | `actions`, `actionsWidth` | `rightActions`/`rightActionsWidth` or `leftActions`/`leftActionsWidth` |
| Removed | `actionsPosition` | Choose the side by which pair you pass. Use `open(side)` for commands. |
| Removed | `SWIPE_DEFAULTS.ACTIONS_POSITION` | No replacement. There is no default side. |
| Removed | Raw `SwipeableView` `actionsWidth`, `actionsPosition` | `leftActionsWidth`/`rightActionsWidth`. The raw view is low-level; prefer `Swipeable`. |
| Removed | Fallback between old and new props | Resolve content in your code, then pass explicit pairs. |
| Changed shape | `interface SwipeableProps` | `type SwipeableProps`, a union of valid side pairs. Extend it with `&`, not `extends`. |
| Unchanged | `open`, `close`, `cancel`, `closeAll`, static keyed methods | Same names. `open` takes an optional side. |
| Unchanged | `onSwipeStart`, `onSwipeStateChange`, `onSwipeEnd`, `onProgress` | Same arguments. Some timing changed, see below. |
| New | - | `onLeftSwipeEnd`, `onRightSwipeEnd`, `appearance`, `hapticFeedback` |
| New | - | Type aliases `TwoSidedSwipeableProps` and `SwipeableComponentProps` (both equal `SwipeableProps`), `SwipeSide`, `SwipeAppearance` |

## Replace the previous single-sided props

Before, right/default actions:

```tsx
<Swipeable actions={<DeleteAction />} actionsWidth={80}>
  <Row />
</Swipeable>
```

After:

```tsx
<Swipeable rightActions={<DeleteAction />} rightActionsWidth={80}>
  <Row />
</Swipeable>
```

Before, left actions:

```tsx
<Swipeable actions={<ReplyAction />} actionsWidth={60} actionsPosition="left">
  <Message />
</Swipeable>
```

After:

```tsx
<Swipeable leftActions={<ReplyAction />} leftActionsWidth={60}>
  <Message />
</Swipeable>
```

For both sides, supply both complete pairs. Select alternate/default content in
the caller before passing it; there is no legacy fallback or precedence resolution.

| Previous input                                | v1 replacement                                                |
| --------------------------------------------- | ------------------------------------------------------------- |
| `actions` and `actionsWidth` on right/default | `rightActions` and `rightActionsWidth`                        |
| `actions` and `actionsWidth` on left          | `leftActions` and `leftActionsWidth`                          |
| `actionsPosition`                             | Select explicit pairs; use `open(side)` for command selection |
| Mixed old and explicit props                  | Caller resolves content, then passes explicit pairs           |

An enabled side needs a finite positive width. Disabled/omitted content has no
width and cannot borrow another edge's width. `null`, `false`, and `undefined`
disable content; numeric `0` is still valid React content. Runtime invalid-width
handling disables the edge and warns in development rather than enabling fallback.
A fully disabled configuration can use `leftActions={null} rightActions={false}`.

### Full-width swipe with no visible actions

Some 0.x screens used `actions={null}` with a full-width `actionsWidth` to slide
the whole screen, for example to swipe back. Before:

```tsx
<Swipeable actions={null} actionsWidth={width} actionsPosition="left">
  <Screen />
</Swipeable>
```

After:

```tsx
<Swipeable leftActions={<View />} leftActionsWidth={width}>
  <Screen />
</Swipeable>
```

In v1, `null` disables the side, so the swipe does not start. An empty `<View />`
keeps the side enabled and shows nothing behind the content. See
[Swipe to go back](../README.md#swipe-to-go-back) for the full recipe.

## Types: removed inputs versus retained aliases

`SwipeableProps` is the canonical explicit-side shape.
`TwoSidedSwipeableProps` and `SwipeableComponentProps` remain aliases of that same
shape. They are not an old/new compatibility union and do not accept removed props.

The previous extendable interface is now a union-based side configuration.
Use an intersection for wrapper-specific fields, not an interface extending that
union. Keep each content/width pair together instead of independently widening
its fields to optional values.

```tsx
import { forwardRef } from "react";
import {
  Swipeable,
  type SwipeableMethods,
  type SwipeableProps,
} from "react-native-swipeable-actions";

type MessageSwipeProps = SwipeableProps & { itemKey: string };

export const MessageSwipe = forwardRef<SwipeableMethods, MessageSwipeProps>(
  function MessageSwipe({ itemKey, ...props }, ref) {
    return <Swipeable {...props} ref={ref} recyclingKey={itemKey} />;
  },
);
```

The ref/static method names and callback signatures remain. `SwipeSide` is
`'left' | 'right'`; `SwipeAppearance` is `'default' | 'ios26'`.
Native child layout and side/key event routing are internal implementation
details, not new arguments to the component's public callbacks.

## Commands and default selection

`open()` and `Swipeable.open(key)` choose enabled right first, otherwise enabled
left. With neither enabled they do nothing. Use `open('left')` when both sides are
enabled and left is intended. An explicit disabled side never opens the opposite
edge. Opening the opposite enabled side closes the current edge before opening it.

`close(animated?)`, `cancel()`, and the static keyed operations remain.
Ref commands still need a usable recycling key. Numeric keys become strings for
the static API. Stable keys identify items, not their current list position or language.

## Intentional behavior changes

Migrated single-side rows deliberately adopt the canonical engine's behavior.
The goal is not to reproduce old implementation quirks.

- **Disabled directions:** dragging toward a disabled edge stays closed without
  starting a swipe lifecycle. The old wrong-direction rubber-band behavior is gone.
- **State callbacks:** threshold/intent transitions follow the enabled, latched
  edge. Code must not depend on the old single-side suppression or incidental
  callback cadence. Public callback argument lists are unchanged.
- **Cancellation:** cancels pending/active interaction and cached open intent
  without completing the action. Continuing the same cancelled touch must not
  restart it; a fresh gesture can. A swipe that settled open before the cancel ran
  has already reported `onSwipeEnd("open")` (without `autoClose`).
- **Instant close:** `close(false)` clears cached open intent. Reattaching or
  restoring that key must not resurrect the old open state.
- **Restoration and widths:** restore the cached physical edge at its current
  width. If it is disabled, restore closed rather than the opposite edge.
  Restoration/width reconciliation is not a new swipe and must not be used as a
  synthetic start/end signal.
- **Completion:** aggregate `onSwipeEnd(state)` precedes the matching side
  callback. Do not wire both to the same business action unless two invocations
  are intended. A successful auto-close gesture reports `'open'` intent after
  returning visually closed; that does not mean the cache remains open.
- **Raw direct gestures:** the direct native gesture path now shares activation,
  threshold and auto-close handling with the canonical engine; it is not the old
  single-side shortcut.

The appearance/haptic options are additive on this breaking base. They work with
one or both explicit sides; they do not restore removed API inputs or behaviors.

## RTL and app migration checklist

1. Map logical start/end actions to physical left/right in your app. RTL does not
   exchange the library's sides, widths, command arguments or side callbacks.
2. Update examples, wrappers, mocks and type fixtures to complete explicit pairs.
3. Keep action padding/gaps inside the declared width and preserve usable targets.
   Give each row a path to its actions without a swipe, with `accessibilityActions`
   on the row content. See [Accessibility](../README.md#accessibility).
4. Keep recycling keys stable through reorder, translation updates and reattachment.
5. Rebuild iOS/Android and rerun application behavior, including close/reset,
   recycling, disabled edges, child gestures, chat auto-close and RTL.
6. Treat earlier physical checks and pre-migration CI as historical evidence,
   not acceptance of the new binary.
