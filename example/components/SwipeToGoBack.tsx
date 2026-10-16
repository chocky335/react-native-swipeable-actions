import { useCallback, useId, useRef } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import {
  Swipeable,
  type SwipeableMethods,
  type SwipeableProps
} from 'react-native-swipeable-actions'

export interface SwipeToGoBackProps {
  /** The screen content. It follows the finger to the right during the swipe. */
  children: SwipeableProps['children']
  /** Called once, after a swipe passes the threshold and the content settles off screen. */
  onBack: () => void
  /**
   * Called when a swipe starts. Return `false` to block it, for example while a draft is
   * unsaved. The content then snaps back and `onBack` is not called.
   */
  canGoBack?: () => boolean
  /** Test identifier of the swipeable container. */
  testID?: string
}

// An empty rail: nothing shows behind the content. It must not be `null`, because
// `null` disables the side in v1.
const EMPTY_RAIL = <View />
const DRAG_OFFSET_FROM_EDGE = 20

/** Slides the whole screen to the right and calls `onBack` after a full swipe. */
export function SwipeToGoBack({ children, onBack, canGoBack, testID }: SwipeToGoBackProps) {
  const { width } = useWindowDimensions()
  const swipeableRef = useRef<SwipeableMethods>(null)
  // `cancel()` needs a key. A new key for each mount keeps a later mount of the
  // screen from restoring the open state of the one that was swiped away.
  const recyclingKey = useId()

  const handleSwipeStart = useCallback(() => {
    if (canGoBack?.() === false) swipeableRef.current?.cancel()
  }, [canGoBack])

  const handleSwipeEnd = useCallback(
    (state: 'open' | 'closed') => {
      if (state === 'open') onBack()
    },
    [onBack]
  )

  return (
    <Swipeable
      ref={swipeableRef}
      testID={testID}
      recyclingKey={recyclingKey}
      leftActions={EMPTY_RAIL}
      leftActionsWidth={width}
      dragOffsetFromEdge={DRAG_OFFSET_FROM_EDGE}
      onSwipeStart={handleSwipeStart}
      onSwipeEnd={handleSwipeEnd}
      style={styles.container}
    >
      {children}
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  // A row container stretches the content to the full screen height.
  container: {
    flex: 1,
    flexDirection: 'row'
  }
})
