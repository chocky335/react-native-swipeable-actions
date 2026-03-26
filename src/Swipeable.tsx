import { forwardRef, useImperativeHandle, useRef, useCallback, useState, useEffect } from 'react'
import { StyleSheet, View, Platform } from 'react-native'

import { SwipeableView } from './SwipeableView'
import { SwipeableActions } from './SwipeableActions'
import {
  SwipeableProps,
  SwipeableMethods,
  SwipeProgressEvent,
  SwipeStateEvent,
  NativeSwipeableRef
} from './Swipeable.types'
import { SWIPE_DEFAULTS } from './constants'
import { openByKey, closeByKey, closeAll, isOpenByKey } from './nativeModuleUtils'

function normalizeRecyclingKey(key: string | number | undefined): string | undefined {
  if (key == null) return undefined
  if (typeof key === 'string') return key
  if (typeof key === 'number' && Number.isFinite(key)) return String(key)

  if (__DEV__) {
    console.warn(`[Swipeable] Invalid recyclingKey: ${key}. Expected string or finite number.`)
  }
  return undefined
}

const Swipeable = forwardRef<SwipeableMethods, SwipeableProps>(function Swipeable(
  {
    children,
    actions,
    actionsWidth,
    actionsPosition = SWIPE_DEFAULTS.ACTIONS_POSITION,
    friction = SWIPE_DEFAULTS.FRICTION,
    threshold = SWIPE_DEFAULTS.THRESHOLD,
    gestureEnabled = SWIPE_DEFAULTS.GESTURE_ENABLED,
    dragOffsetFromEdge = SWIPE_DEFAULTS.DRAG_OFFSET_FROM_EDGE,
    style,
    testID,
    onSwipeStart,
    onSwipeStateChange,
    onSwipeEnd,
    onProgress,
    autoClose = false,
    autoCloseTimeout = 0,
    recyclingKey
  },
  ref
) {
  const nativeRef = useRef<NativeSwipeableRef>(null)
  // Initialize from native cache: if this recyclingKey was open, render actions immediately.
  // This handles FlatList remounting components during data reorder - React state is lost
  // but native cache preserves the open state.
  const [hasActionsRendered, setHasActionsRendered] = useState(() => {
    const cachedOpen = normalizedKey != null && isOpenByKey(normalizedKey)
    return cachedOpen
  })
  const swipeStartedRef = useRef(false)

  // When recyclingKey changes (FlatList reorder/recycle), check if the new key
  // was previously open. FlatList reuses component instances without remounting,
  // so useState initializer doesn't re-run. This effect syncs hasActionsRendered
  // with the native cached open state when the key changes.
  useEffect(() => {
    if (normalizedKey && !hasActionsRendered && isOpenByKey(normalizedKey)) {
      setHasActionsRendered(true)
    }
  }, [normalizedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Normalize and sync recyclingKey to ref for use in useImperativeHandle
  // (set during render to ensure it's always current before callbacks fire)
  const normalizedKey = normalizeRecyclingKey(recyclingKey)
  const recyclingKeyRef = useRef<string | undefined>(undefined)
  recyclingKeyRef.current = normalizedKey

  // Development-time validation
  if (__DEV__) {
    if (autoClose && recyclingKey == null) {
      console.warn(
        '[Swipeable] autoClose is enabled but recyclingKey is not set. ' +
          'This may cause issues in virtualized lists. Consider adding a recyclingKey prop.'
      )
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      close: (animated?: boolean) => {
        const key = recyclingKeyRef.current
        if (key) {
          closeByKey(key, animated)
        } else if (__DEV__) {
          console.warn('[Swipeable] close() called without recyclingKey - method has no effect')
        }
      },
      open: () => {
        const key = recyclingKeyRef.current
        if (key) {
          openByKey(key)
        } else if (__DEV__) {
          console.warn('[Swipeable] open() called without recyclingKey - method has no effect')
        }
      }
    }),
    []
  )

  const handleSwipeStart = useCallback(() => {
    if (!hasActionsRendered) {
      setHasActionsRendered(true)
    }

    if (!swipeStartedRef.current) {
      swipeStartedRef.current = true
      onSwipeStart?.()
    }
  }, [hasActionsRendered, onSwipeStart])

  const handleSwipeProgress = useCallback(
    (event: SwipeProgressEvent) => {
      const newProgress = event.nativeEvent.progress
      const clamped = Math.max(0, Math.min(1, newProgress))
      onProgress?.(clamped)
    },
    [onProgress]
  )

  const handleSwipeStateChange = useCallback(
    (event: SwipeStateEvent) => {
      onSwipeStateChange?.(event.nativeEvent.state)
    },
    [onSwipeStateChange]
  )

  const handleSwipeEnd = useCallback(
    (event: SwipeStateEvent) => {
      swipeStartedRef.current = false
      onSwipeEnd?.(event.nativeEvent.state)
    },
    [onSwipeEnd]
  )

  return (
    <SwipeableView
      ref={nativeRef}
      style={[styles.container, style]}
      actionsWidth={actionsWidth}
      actionsPosition={actionsPosition}
      friction={friction}
      threshold={threshold}
      gestureEnabled={gestureEnabled}
      dragOffsetFromEdge={dragOffsetFromEdge}
      autoClose={autoClose}
      autoCloseTimeout={autoCloseTimeout}
      {...(normalizedKey ? { recyclingKey: normalizedKey } : {})}
      {...(testID ? { testID } : {})}
      onSwipeStart={handleSwipeStart}
      onSwipeProgress={handleSwipeProgress}
      onSwipeStateChange={handleSwipeStateChange}
      onSwipeEnd={handleSwipeEnd}
    >
      {(hasActionsRendered || (normalizedKey != null && isOpenByKey(normalizedKey))) && (
        <SwipeableActions actionsPosition={actionsPosition} testID={testID ? `${testID}-actions` : undefined}>{actions}</SwipeableActions>
      )}

      <View style={styles.content}>{children}</View>
    </SwipeableView>
  )
})

const styles = StyleSheet.create({
  container: {
    // iOS: overflow hidden works with native clipsToBounds
    // Android: overflow visible required, native handles clipping
    overflow: Platform.OS === 'ios' ? 'hidden' : 'visible'
  },
  content: {
    width: '100%'
  }
})

Swipeable.displayName = 'Swipeable'

// Static methods for controlling Swipeables by recyclingKey
type SwipeableWithStatic = typeof Swipeable & {
  open: (recyclingKey: string) => void
  close: (recyclingKey: string, animated?: boolean) => void
  closeAll: (animated?: boolean) => void
}

const SwipeableExport = Swipeable as SwipeableWithStatic

SwipeableExport.open = (recyclingKey: string) => {
  if (__DEV__ && (!recyclingKey || typeof recyclingKey !== 'string')) {
    console.warn('[Swipeable.open] recyclingKey must be a non-empty string')
    return
  }
  openByKey(recyclingKey)
}

SwipeableExport.close = (recyclingKey: string, animated?: boolean) => {
  if (__DEV__ && (!recyclingKey || typeof recyclingKey !== 'string')) {
    console.warn('[Swipeable.close] recyclingKey must be a non-empty string')
    return
  }
  closeByKey(recyclingKey, animated)
}

SwipeableExport.closeAll = (animated?: boolean) => {
  closeAll(animated)
}

export default SwipeableExport
