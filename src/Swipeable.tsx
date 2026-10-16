import {
  Fragment,
  type ForwardRefExoticComponent,
  type RefAttributes,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { SWIPE_DEFAULTS } from './constants'
import {
  cancelByKey,
  closeAll,
  closeByKey,
  getOpenSideByKey,
  openByKey,
  openByKeyOnSide
} from './nativeModuleUtils'
import { resolveSwipeableActions } from './resolveSwipeableActions'
import type {
  ActionsNeededEvent,
  NativeSwipeableRef,
  SwipeSide,
  SwipeableComponentProps,
  SwipeableMethods,
  SwipeableStatic,
  SwipeProgressEvent,
  SwipeStartEvent,
  SwipeStateEvent
} from './Swipeable.types'
import { SwipeableActions } from './SwipeableActions'
import { SwipeableView } from './SwipeableView'

function normalizeRecyclingKey(key: string | number | undefined): string | undefined {
  if (key == null) return undefined
  if (typeof key === 'string') return key
  if (typeof key === 'number' && Number.isFinite(key)) return String(key)

  if (__DEV__) {
    console.warn(`[Swipeable] Invalid recyclingKey: ${key}. Expected string or finite number.`)
  }
  return undefined
}

const Swipeable = forwardRef<SwipeableMethods, SwipeableComponentProps>(function Swipeable(
  {
    children,
    leftActions,
    leftActionsWidth,
    rightActions,
    rightActionsWidth,
    onLeftSwipeEnd,
    onRightSwipeEnd,
    appearance = 'default',
    hapticFeedback,
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
  const resolved = useMemo(
    () =>
      resolveSwipeableActions({
        leftActions,
        ...(leftActionsWidth !== undefined ? { leftActionsWidth } : {}),
        rightActions,
        ...(rightActionsWidth !== undefined ? { rightActionsWidth } : {})
      }),
    [leftActions, leftActionsWidth, rightActions, rightActionsWidth]
  )

  // Normalize recyclingKey before hooks that depend on it
  const normalizedKey = normalizeRecyclingKey(recyclingKey)
  const recyclingKeyRef = useRef<string | undefined>(undefined)
  recyclingKeyRef.current = normalizedKey

  // Hydrate the cached physical edge, including after a keyed list remount.
  const swipeStartedRef = useRef(false)
  const cachedSide = useMemo(
    () => (normalizedKey != null ? getOpenSideByKey(normalizedKey) : null),
    [normalizedKey]
  )
  const initialSides = useMemo(
    () => ({
      key: normalizedKey,
      left: cachedSide === 'left',
      right: cachedSide === 'right'
    }),
    [normalizedKey, cachedSide]
  )
  const [renderedSides, setRenderedSides] = useState(initialSides)
  const sides = renderedSides.key === normalizedKey ? renderedSides : initialSides

  useEffect(() => {
    setRenderedSides((previous) => (previous.key === normalizedKey ? previous : initialSides))
    swipeStartedRef.current = false
  }, [initialSides, normalizedKey])

  const warningText = resolved.warnings.join('\n')
  useEffect(() => {
    if (__DEV__ && warningText) console.warn(`[Swipeable] ${warningText}`)
  }, [warningText])

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
      open: (side?: SwipeSide) => {
        const key = recyclingKeyRef.current
        if (key) {
          if (side === undefined) openByKey(key)
          else openByKeyOnSide(key, side)
        } else if (__DEV__) {
          console.warn('[Swipeable] open() called without recyclingKey - method has no effect')
        }
      },
      cancel: () => {
        const key = recyclingKeyRef.current
        if (key) {
          cancelByKey(key)
          // Native cancelGesture() short-circuits handlePanEnded so onSwipeEnd
          // is never emitted. Reset the JS-side gate so the next gesture fires
          // onSwipeStart to our consumer again.
          swipeStartedRef.current = false
        } else if (__DEV__) {
          console.warn('[Swipeable] cancel() called without recyclingKey - method has no effect')
        }
      }
    }),
    []
  )

  const handleSwipeStart = useCallback(
    (event: SwipeStartEvent) => {
      // Missing metadata identifies the unkeyed native binding. It must not
      // bypass identity checks after recycling into a keyed row.
      if (event.nativeEvent.recyclingKey !== (normalizedKey || undefined)) return
      if (!swipeStartedRef.current) {
        swipeStartedRef.current = true
        onSwipeStart?.()
      }
    },
    [normalizedKey, onSwipeStart]
  )

  const handleGestureCancelled = useCallback(
    (event: { nativeEvent: { recyclingKey?: string } }) => {
      if (event.nativeEvent.recyclingKey !== (normalizedKey || undefined)) return
      swipeStartedRef.current = false
    },
    [normalizedKey]
  )

  const handleActionsNeeded = useCallback(
    (event: ActionsNeededEvent) => {
      const side = event.nativeEvent.side
      if (event.nativeEvent.recyclingKey !== (normalizedKey || undefined)) return
      if ((side !== 'left' && side !== 'right') || resolved[side].width <= 0) return
      setRenderedSides((previous) => {
        const current = previous.key === normalizedKey ? previous : initialSides
        return current[side] ? current : { ...current, [side]: true }
      })
    },
    [initialSides, normalizedKey, resolved]
  )

  const handleSwipeProgress = useCallback(
    (event: SwipeProgressEvent) => {
      if (event.nativeEvent.recyclingKey !== (normalizedKey || undefined)) return
      const newProgress = event.nativeEvent.progress
      const clamped = Math.max(0, Math.min(1, newProgress))
      onProgress?.(clamped)
    },
    [normalizedKey, onProgress]
  )

  const handleSwipeStateChange = useCallback(
    (event: SwipeStateEvent) => {
      if (event.nativeEvent.recyclingKey !== (normalizedKey || undefined)) return
      onSwipeStateChange?.(event.nativeEvent.state)
    },
    [normalizedKey, onSwipeStateChange]
  )

  const handleSwipeEnd = useCallback(
    (event: SwipeStateEvent) => {
      if (event.nativeEvent.recyclingKey !== (normalizedKey || undefined)) return
      swipeStartedRef.current = false
      onSwipeEnd?.(event.nativeEvent.state)
      const side = event.nativeEvent.side
      if (side === 'left') onLeftSwipeEnd?.(event.nativeEvent.state)
      if (side === 'right') onRightSwipeEnd?.(event.nativeEvent.state)
    },
    [normalizedKey, onLeftSwipeEnd, onRightSwipeEnd, onSwipeEnd]
  )

  return (
    <SwipeableView
      ref={nativeRef}
      style={[styles.container, style]}
      leftActionsWidth={resolved.left.width}
      rightActionsWidth={resolved.right.width}
      onActionsNeeded={handleActionsNeeded}
      {...(Platform.OS === 'ios'
        ? { appearance, hapticFeedback: hapticFeedback ?? appearance === 'ios26' }
        : {})}
      friction={friction}
      threshold={threshold}
      gestureEnabled={gestureEnabled}
      dragOffsetFromEdge={dragOffsetFromEdge}
      autoClose={autoClose}
      autoCloseTimeout={autoCloseTimeout}
      {...(normalizedKey ? { recyclingKey: normalizedKey } : {})}
      {...(testID ? { testID } : {})}
      onSwipeStart={handleSwipeStart}
      onGestureCancelled={handleGestureCancelled}
      onSwipeProgress={handleSwipeProgress}
      onSwipeStateChange={handleSwipeStateChange}
      onSwipeEnd={handleSwipeEnd}
    >
      <SwipeableActions
        key='left-slot'
        actionsPosition='left'
        {...(testID ? { testID: `${testID}-left-actions` } : {})}
      >
        <Fragment key={normalizedKey ?? ''}>
          {sides.left && resolved.left.width > 0 ? resolved.left.node : null}
        </Fragment>
      </SwipeableActions>
      <SwipeableActions
        key='right-slot'
        actionsPosition='right'
        {...(testID ? { testID: `${testID}-right-actions` } : {})}
      >
        <Fragment key={normalizedKey ?? ''}>
          {sides.right && resolved.right.width > 0 ? resolved.right.node : null}
        </Fragment>
      </SwipeableActions>
      <View key='content' style={styles.content} collapsable={false}>
        {children}
      </View>
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
type SwipeableWithStatic = ForwardRefExoticComponent<
  SwipeableComponentProps & RefAttributes<SwipeableMethods>
> &
  SwipeableStatic

const SwipeableExport = Swipeable as SwipeableWithStatic

SwipeableExport.open = (recyclingKey: string, side?: SwipeSide) => {
  if (__DEV__ && (!recyclingKey || typeof recyclingKey !== 'string')) {
    console.warn('[Swipeable.open] recyclingKey must be a non-empty string')
    return
  }
  if (side === undefined) openByKey(recyclingKey)
  else openByKeyOnSide(recyclingKey, side)
}

SwipeableExport.close = (recyclingKey: string, animated?: boolean) => {
  if (__DEV__ && (!recyclingKey || typeof recyclingKey !== 'string')) {
    console.warn('[Swipeable.close] recyclingKey must be a non-empty string')
    return
  }
  closeByKey(recyclingKey, animated)
}

SwipeableExport.cancel = (recyclingKey: string) => {
  if (__DEV__ && (!recyclingKey || typeof recyclingKey !== 'string')) {
    console.warn('[Swipeable.cancel] recyclingKey must be a non-empty string')
    return
  }
  cancelByKey(recyclingKey)
}

SwipeableExport.closeAll = (animated?: boolean) => {
  closeAll(animated)
}

export default SwipeableExport
