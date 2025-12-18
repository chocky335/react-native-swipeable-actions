# react-native-swipeable-actions

A high-performance native swipeable row component for React Native. Native alternative to `react-native-gesture-handler/Swipeable` - no `react-native-reanimated` required.

## Features

- Pure native gestures - no JS thread blocking
- 60fps spring animations on both iOS and Android
- No `react-native-reanimated` dependency
- Built-in FlashList/virtualized list support via `recyclingKey`
- AutoClose pattern for chat-style swipe-to-reply
- Lazy action rendering for optimal performance

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
import { Swipeable, SwipeableMethods } from 'react-native-swipeable-actions'
import { useRef } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'

function DeleteAction({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.deleteAction}>
      <Text style={styles.actionText}>Delete</Text>
    </TouchableOpacity>
  )
}

function MyRow() {
  const swipeableRef = useRef<SwipeableMethods>(null)

  return (
    <Swipeable
      ref={swipeableRef}
      actions={<DeleteAction onPress={() => console.log('Delete!')} />}
      actionsWidth={80}
      onSwipeEnd={(state) => console.log('Swipe ended:', state)}
    >
      <View style={styles.row}>
        <Text>Swipe me left</Text>
      </View>
    </Swipeable>
  )
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | required | Row content |
| `actions` | `ReactNode` | required | Action buttons revealed on swipe |
| `actionsWidth` | `number` | required | Width of actions container in pixels |
| `actionsPosition` | `'left' \| 'right'` | `'right'` | Position of actions (`'left'` = swipe right to reveal) |
| `friction` | `number` | `1` | Drag damping factor (0-1). Lower = more resistance |
| `threshold` | `number` | `0.4` | Snap-to threshold as percentage of actionsWidth (0-1) |
| `dragOffsetFromEdge` | `number` | `0` | Minimum drag distance before gesture starts |
| `autoClose` | `boolean` | `false` | Auto-close after swipe release (for swipe-to-reply) |
| `autoCloseTimeout` | `number` | `0` | Delay in ms before auto-closing |
| `recyclingKey` | `string \| number` | - | Unique key for FlashList/recycling support |
| `style` | `StyleProp<ViewStyle>` | - | Container style |
| `testID` | `string` | - | Test ID for e2e testing |

## Callbacks

| Callback | Type | Description |
|----------|------|-------------|
| `onSwipeStart` | `() => void` | Called when swipe gesture begins |
| `onSwipeStateChange` | `(state: 'open' \| 'closed') => void` | Called when gesture ends (before animation) |
| `onSwipeEnd` | `(state: 'open' \| 'closed') => void` | Called when animation completes |
| `onProgress` | `(progress: number) => void` | Called on each frame (0 = closed, 1 = fully open) |

## Ref Methods

Access via ref:

```tsx
const swipeableRef = useRef<SwipeableMethods>(null)

// Close the row (with optional animation)
swipeableRef.current?.close()         // animated
swipeableRef.current?.close(false)    // instant

// Open the row
swipeableRef.current?.open()
```

## Static Methods

Control swipeables globally by their `recyclingKey`:

```tsx
import { Swipeable } from 'react-native-swipeable-actions'

// Open a specific row
Swipeable.open('row-1')

// Close a specific row
Swipeable.close('row-1')           // animated
Swipeable.close('row-1', false)    // instant

// Close all open rows
Swipeable.closeAll()               // animated
Swipeable.closeAll(false)          // instant
```

## AutoClose Pattern (Swipe-to-Reply)

For chat-style swipe-to-reply where the row should automatically close:

```tsx
<Swipeable
  actions={<ReplyIndicator />}
  actionsWidth={60}
  actionsPosition="right"
  autoClose={true}
  threshold={0.6}
  onSwipeEnd={(state) => {
    if (state === 'open') {
      // Trigger reply action
      onReply(message)
    }
  }}
>
  <ChatMessage message={message} />
</Swipeable>
```

## FlashList Integration

For virtualized lists, use `recyclingKey` to persist swipe state across recycling:

```tsx
import { FlashList } from '@shopify/flash-list'

function MessageList({ messages }) {
  return (
    <FlashList
      data={messages}
      renderItem={({ item }) => (
        <Swipeable
          recyclingKey={item.id}
          actions={<DeleteAction />}
          actionsWidth={80}
        >
          <MessageRow message={item} />
        </Swipeable>
      )}
      estimatedItemSize={60}
    />
  )
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
- Actions rendered lazily on first swipe gesture (performance optimization)
- Recycling key enables state persistence in virtualized lists
- No SharedValue dependency - progress synced via native events

## Platform Support

| Platform | Version |
|----------|---------|
| iOS | 12.0+ |
| Android | API 21+ |

## TypeScript

Full TypeScript support with exported types:

```tsx
import {
  Swipeable,
  SwipeableProps,
  SwipeableMethods,
  SwipeableStatic,
  SwipeProgressEvent,
  SwipeStateEvent,
} from 'react-native-swipeable-actions'
```

## Testing

Jest mock is included for testing components that use Swipeable:

```js
// jest.config.js
import 'react-native-swipeable-actions/jestSetup.js'
```

## License

MIT
