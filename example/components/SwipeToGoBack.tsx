import { useCallback, useId, useRef } from 'react'
import { I18nManager, StyleSheet, useWindowDimensions } from 'react-native'
import {
  type GestureInsets,
  Swipeable,
  type SwipeableMethods,
  type SwipeableProps
} from 'react-native-swipeable-actions'

export interface SwipeToGoBackProps {
  /** The screen content. It follows the finger during the swipe. */
  children: SwipeableProps['children']
  /** Called once, after a swipe passes the threshold and the content settles off screen. */
  onBack: () => void
  /**
   * Return `false` to block the swipe, for example while a draft is unsaved. The content
   * then snaps back and `onBack` is not called. It is called when a swipe starts, and again
   * after a swipe opens, because the start event is asynchronous and the swipe can settle
   * open before `cancel()` runs.
   */
  canGoBack?: () => boolean
  /**
   * Edge bands where a touch does not start the swipe. Use it for a horizontal pager
   * inside the screen: the pager gets the drags that start in its band.
   */
  gestureInsets?: GestureInsets
  /** Test identifier of the swipeable container. */
  testID?: string
}

const DRAG_OFFSET_FROM_EDGE = 20

/**
 * Slides the whole screen away with the finger and calls `onBack` after a full swipe.
 * The screen slides to the right, or to the left in a right-to-left layout.
 */
export function SwipeToGoBack({
  children,
  onBack,
  canGoBack,
  gestureInsets,
  testID
}: SwipeToGoBackProps) {
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
      if (state !== 'open') return
      if (canGoBack?.() === false) {
        swipeableRef.current?.close()
        return
      }
      onBack()
    },
    [canGoBack, onBack]
  )

  return (
    <Swipeable
      ref={swipeableRef}
      testID={testID}
      recyclingKey={recyclingKey}
      leftActionsWidth={width}
      isRTL={I18nManager.isRTL}
      dragOffsetFromEdge={DRAG_OFFSET_FROM_EDGE}
      {...(gestureInsets ? { gestureInsets } : {})}
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
