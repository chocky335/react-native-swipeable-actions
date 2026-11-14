import {
  Fragment,
  type ForwardRefExoticComponent,
  type RefAttributes,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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

const mirror = (side: SwipeSide): SwipeSide => (side === 'left' ? 'right' : 'left')

// A static command has only the key, so each mounted isRTL row lists its default side here.
const mirroredRows = new Map<string, () => SwipeSide | null>()

/** The native side for a command, `undefined` for the native default, `null` for no side. */
function nativeOpenSide(
  side: SwipeSide | undefined,
  defaultSide: (() => SwipeSide | null) | undefined
): SwipeSide | null | undefined {
  if (!defaultSide) return side
  const named = side ?? defaultSide()
  return named ? mirror(named) : null
}

/** Like the native default: the right side if it is enabled, else the left side. */
function defaultOpenSide(leftWidth: number, rightWidth: number): SwipeSide | null {
  if (rightWidth > 0) return 'right'
  return leftWidth > 0 ? 'left' : null
}

function openNative(key: string, side: SwipeSide | null | undefined) {
  if (side === undefined) openByKey(key)
  else if (side) openByKeyOnSide(key, side)
}

const Swipeable = forwardRef<SwipeableMethods, SwipeableComponentProps>(function Swipeable(
  {
    children,
    leftActions,
    leftActionsWidth,
    rightActions,
    rightActionsWidth,
    isRTL = false,
    onLeftSwipeEnd,
    onRightSwipeEnd,
    appearance = 'default',
    hapticFeedback,
    friction = SWIPE_DEFAULTS.FRICTION,
    threshold = SWIPE_DEFAULTS.THRESHOLD,
    gestureEnabled = SWIPE_DEFAULTS.GESTURE_ENABLED,
    gestureInsets,
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
  const named = useMemo(
    () =>
      resolveSwipeableActions({
        leftActions,
        ...(leftActionsWidth !== undefined ? { leftActionsWidth } : {}),
        rightActions,
        ...(rightActionsWidth !== undefined ? { rightActionsWidth } : {})
      }),
    [leftActions, leftActionsWidth, rightActions, rightActionsWidth]
  )
  // From here on `resolved` holds the native, physical sides.
  const resolved = useMemo(
    () => (isRTL ? { ...named, left: named.right, right: named.left } : named),
    [isRTL, named]
  )
  const insetProps = useMemo(() => {
    if (!gestureInsets) return null
    if (!isRTL) return { gestureInsets }
    const { left, right, ...vertical } = gestureInsets
    return {
      gestureInsets: {
        ...vertical,
        ...(right !== undefined ? { left: right } : {}),
        ...(left !== undefined ? { right: left } : {})
      }
    }
  }, [gestureInsets, isRTL])
  // The ref handle and the static registry outlive a render, so they read through refs.
  const isRTLRef = useRef(isRTL)
  isRTLRef.current = isRTL
  const defaultSideRef = useRef<SwipeSide | null>(null)
  defaultSideRef.current = defaultOpenSide(named.left.width, named.right.width)
  const readDefaultSide = useCallback(() => defaultSideRef.current, [])

  // Normalize recyclingKey before hooks that depend on it
  const normalizedKey = normalizeRecyclingKey(recyclingKey)
  const recyclingKeyRef = useRef<string | undefined>(undefined)
  recyclingKeyRef.current = normalizedKey

  // The binding whose swipe fired onSwipeStart, or null when idle. A recycled row needs
  // no reset: its new key never matches.
  const startedSwipeRef = useRef<{ key: string | undefined } | null>(null)

  // Hydrate the cached physical edge, including after a keyed list remount.
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
  // The state holds the sides a key asked for, tagged with that key. A recycle sets no
  // state: a side mounts if the native cache has it open or the current key asked for it.
  const [renderedSides, setRenderedSides] = useState(initialSides)
  const ownSides = renderedSides.key === normalizedKey ? renderedSides : null
  const showLeft = initialSides.left || ownSides?.left === true
  const showRight = initialSides.right || ownSides?.right === true

  // A layout effect, so a static command from any passive mount effect sees the row.
  useLayoutEffect(() => {
    if (!isRTL || !normalizedKey) return
    mirroredRows.set(normalizedKey, readDefaultSide)
    return () => {
      if (mirroredRows.get(normalizedKey) === readDefaultSide) mirroredRows.delete(normalizedKey)
    }
  }, [isRTL, normalizedKey, readDefaultSide])

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
          openNative(key, nativeOpenSide(side, isRTLRef.current ? readDefaultSide : undefined))
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
          startedSwipeRef.current = null
        } else if (__DEV__) {
          console.warn('[Swipeable] cancel() called without recyclingKey - method has no effect')
        }
      }
    }),
    [readDefaultSide]
  )

  const handleSwipeStart = useCallback(
    (event: SwipeStartEvent) => {
      // Missing metadata identifies the unkeyed native binding. It must not
      // bypass identity checks after recycling into a keyed row.
      const key = event.nativeEvent.recyclingKey
      if (key !== (normalizedKey || undefined)) return
      const started = startedSwipeRef.current
      if (started && started.key === key) return
      startedSwipeRef.current = { key }
      onSwipeStart?.()
    },
    [normalizedKey, onSwipeStart]
  )

  const handleGestureCancelled = useCallback(
    (event: { nativeEvent: { recyclingKey?: string } }) => {
      // A cancel for an old binding can arrive after a recycle. It clears only that binding.
      if (startedSwipeRef.current?.key === event.nativeEvent.recyclingKey) {
        startedSwipeRef.current = null
      }
    },
    []
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
      const key = event.nativeEvent.recyclingKey
      if (key !== (normalizedKey || undefined)) {
        // An end for an old binding can arrive after a recycle. It clears only that binding.
        if (startedSwipeRef.current?.key === key) startedSwipeRef.current = null
        return
      }
      startedSwipeRef.current = null
      onSwipeEnd?.(event.nativeEvent.state)
      const nativeSide = event.nativeEvent.side
      const side = isRTL && nativeSide ? mirror(nativeSide) : nativeSide
      if (side === 'left') onLeftSwipeEnd?.(event.nativeEvent.state)
      if (side === 'right') onRightSwipeEnd?.(event.nativeEvent.state)
    },
    [isRTL, normalizedKey, onLeftSwipeEnd, onRightSwipeEnd, onSwipeEnd]
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
      {...insetProps}
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
          {showLeft && resolved.left.width > 0 ? resolved.left.node : null}
        </Fragment>
      </SwipeableActions>
      <SwipeableActions
        key='right-slot'
        actionsPosition='right'
        {...(testID ? { testID: `${testID}-right-actions` } : {})}
      >
        <Fragment key={normalizedKey ?? ''}>
          {showRight && resolved.right.width > 0 ? resolved.right.node : null}
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
  openNative(recyclingKey, nativeOpenSide(side, mirroredRows.get(recyclingKey)))
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
