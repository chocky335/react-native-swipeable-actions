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
  isOpenByKey,
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
  SwipeableProps,
  SwipeableStatic,
  SwipeProgressEvent,
  SwipeStateEvent,
  TwoSidedSwipeableProps
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
    actions,
    actionsWidth,
    leftActions,
    leftActionsWidth,
    rightActions,
    rightActionsWidth,
    onLeftSwipeEnd,
    onRightSwipeEnd,
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
  const resolved = useMemo(
    () =>
      resolveSwipeableActions({
        actions,
        actionsPosition,
        ...(actionsWidth !== undefined ? { actionsWidth } : {}),
        leftActions,
        ...(leftActionsWidth !== undefined ? { leftActionsWidth } : {}),
        rightActions,
        ...(rightActionsWidth !== undefined ? { rightActionsWidth } : {})
      }),
    [
      actions,
      actionsWidth,
      actionsPosition,
      leftActions,
      leftActionsWidth,
      rightActions,
      rightActionsWidth
    ]
  )
  const { twoSided } = resolved

  // Normalize recyclingKey before hooks that depend on it
  const normalizedKey = normalizeRecyclingKey(recyclingKey)
  const recyclingKeyRef = useRef<string | undefined>(undefined)
  recyclingKeyRef.current = normalizedKey

  // Initialize from native cache: if this recyclingKey was open, render actions immediately.
  // This handles FlatList remounting components during data reorder - React state is lost
  // but native cache preserves the open state.
  const [hasActionsRendered, setHasActionsRendered] = useState(() => {
    return !twoSided && normalizedKey != null && isOpenByKey(normalizedKey)
  })
  const swipeStartedRef = useRef(false)
  const cachedSide = useMemo(
    () => (twoSided && normalizedKey != null ? getOpenSideByKey(normalizedKey) : null),
    [twoSided, normalizedKey]
  )
  const initialSides = useMemo(
    () => ({
      key: normalizedKey,
      twoSided,
      left: cachedSide === 'left',
      right: cachedSide === 'right'
    }),
    [normalizedKey, twoSided, cachedSide]
  )
  const [renderedSides, setRenderedSides] = useState(initialSides)
  const sides =
    renderedSides.key === normalizedKey && renderedSides.twoSided === twoSided
      ? renderedSides
      : initialSides

  useEffect(() => {
    setRenderedSides((previous) =>
      previous.key === normalizedKey && previous.twoSided === twoSided ? previous : initialSides
    )
    if (twoSided) swipeStartedRef.current = false
  }, [initialSides, normalizedKey, twoSided])

  const warningText = resolved.warnings.join('\n')
  useEffect(() => {
    if (__DEV__ && warningText) console.warn(`[Swipeable] ${warningText}`)
  }, [warningText])

  // When recyclingKey changes (FlatList reorder/recycle), sync hasActionsRendered
  // with the native cached open state. FlatList reuses component instances without
  // remounting, so useState initializer doesn't re-run.
  useEffect(() => {
    if (twoSided || !normalizedKey) return
    const cachedOpen = isOpenByKey(normalizedKey)
    setHasActionsRendered(cachedOpen)
  }, [normalizedKey, twoSided])

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

  const handleSwipeStart = useCallback(() => {
    if (!twoSided && !hasActionsRendered) {
      setHasActionsRendered(true)
    }

    if (!swipeStartedRef.current) {
      swipeStartedRef.current = true
      onSwipeStart?.()
    }
  }, [hasActionsRendered, onSwipeStart, twoSided])

  const handleActionsNeeded = useCallback(
    (event: ActionsNeededEvent) => {
      const side = event.nativeEvent.side
      if (
        event.nativeEvent.recyclingKey !== undefined &&
        event.nativeEvent.recyclingKey !== normalizedKey
      )
        return
      if (!twoSided || (side !== 'left' && side !== 'right') || resolved[side].width <= 0) return
      setRenderedSides((previous) => {
        const current =
          previous.key === normalizedKey && previous.twoSided === twoSided ? previous : initialSides
        return current[side] ? current : { ...current, [side]: true }
      })
    },
    [initialSides, normalizedKey, resolved, twoSided]
  )

  const handleSwipeProgress = useCallback(
    (event: SwipeProgressEvent) => {
      if (
        twoSided &&
        event.nativeEvent.recyclingKey !== undefined &&
        event.nativeEvent.recyclingKey !== normalizedKey
      )
        return
      const newProgress = event.nativeEvent.progress
      const clamped = Math.max(0, Math.min(1, newProgress))
      onProgress?.(clamped)
    },
    [normalizedKey, onProgress, twoSided]
  )

  const handleSwipeStateChange = useCallback(
    (event: SwipeStateEvent) => {
      if (
        twoSided &&
        event.nativeEvent.recyclingKey !== undefined &&
        event.nativeEvent.recyclingKey !== normalizedKey
      )
        return
      onSwipeStateChange?.(event.nativeEvent.state)
    },
    [normalizedKey, onSwipeStateChange, twoSided]
  )

  const handleSwipeEnd = useCallback(
    (event: SwipeStateEvent) => {
      if (
        twoSided &&
        event.nativeEvent.recyclingKey !== undefined &&
        event.nativeEvent.recyclingKey !== normalizedKey
      )
        return
      swipeStartedRef.current = false
      onSwipeEnd?.(event.nativeEvent.state)
      const side = event.nativeEvent.side ?? (twoSided ? undefined : actionsPosition)
      if (side === 'left') onLeftSwipeEnd?.(event.nativeEvent.state)
      if (side === 'right') onRightSwipeEnd?.(event.nativeEvent.state)
    },
    [actionsPosition, normalizedKey, onLeftSwipeEnd, onRightSwipeEnd, onSwipeEnd, twoSided]
  )

  return (
    <SwipeableView
      ref={nativeRef}
      style={[styles.container, style]}
      actionsWidth={twoSided ? 0 : (actionsWidth ?? 0)}
      actionsPosition={actionsPosition}
      twoSided={twoSided}
      leftActionsWidth={twoSided ? resolved.left.width : 0}
      rightActionsWidth={twoSided ? resolved.right.width : 0}
      onActionsNeeded={handleActionsNeeded}
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
      {twoSided ? (
        <>
          <SwipeableActions
            key='left-slot'
            slot
            actionsPosition='left'
            {...(testID ? { testID: `${testID}-left-actions` } : {})}
          >
            <Fragment key={normalizedKey ?? ''}>
              {sides.left && resolved.left.width > 0 ? resolved.left.node : null}
            </Fragment>
          </SwipeableActions>
          <SwipeableActions
            key='right-slot'
            slot
            actionsPosition='right'
            {...(testID ? { testID: `${testID}-right-actions` } : {})}
          >
            <Fragment key={normalizedKey ?? ''}>
              {sides.right && resolved.right.width > 0 ? resolved.right.node : null}
            </Fragment>
          </SwipeableActions>
        </>
      ) : hasActionsRendered ? (
        <SwipeableActions
          actionsPosition={actionsPosition}
          {...(testID ? { testID: `${testID}-actions` } : {})}
        >
          {actions}
        </SwipeableActions>
      ) : null}

      <View key='content' style={styles.content} {...(twoSided ? { collapsable: false } : {})}>
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
  TwoSidedSwipeableProps & RefAttributes<SwipeableMethods>
> &
  ForwardRefExoticComponent<SwipeableProps & RefAttributes<SwipeableMethods>> &
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
