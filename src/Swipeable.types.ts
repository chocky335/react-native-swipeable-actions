import type { ReactNode, Ref } from 'react'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

export type SwipeSide = 'left' | 'right'

/** Internal native identity; the consumer's onSwipeStart remains zero-argument. */
export interface SwipeStartEvent {
  nativeEvent: { recyclingKey?: string; side?: SwipeSide }
}

export interface ActionsNeededEvent {
  nativeEvent: { side: SwipeSide; recyclingKey?: string }
}

export interface SwipeProgressEvent {
  nativeEvent: {
    progress: number
    translationX: number
    side?: SwipeSide
    recyclingKey?: string
  }
}

export interface SwipeStateEvent {
  nativeEvent: {
    state: 'open' | 'closed'
    side?: SwipeSide
    recyclingKey?: string
  }
}

export interface NativeSwipeableRef {
  close: (animated?: boolean) => Promise<void>
  open: () => Promise<void>
  cancel: () => Promise<void>
}

/** Native child order is always left slot, right slot, then content. */
export interface SwipeableViewProps extends ViewProps {
  leftActionsWidth?: number
  rightActionsWidth?: number
  onActionsNeeded?: (event: ActionsNeededEvent) => void
  friction?: number
  threshold?: number
  gestureEnabled?: boolean
  dragOffsetFromEdge?: number
  recyclingKey?: string
  onSwipeProgress?: (event: SwipeProgressEvent) => void
  onSwipeStart?: (event: SwipeStartEvent) => void
  onSwipeStateChange?: (event: SwipeStateEvent) => void
  onSwipeEnd?: (event: SwipeStateEvent) => void
  autoClose?: boolean
  autoCloseTimeout?: number
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  nativeRef?: Ref<NativeSwipeableRef>
  testID?: string
}

interface SwipeableCommonProps {
  children: ReactNode
  onLeftSwipeEnd?: (state: 'open' | 'closed') => void
  onRightSwipeEnd?: (state: 'open' | 'closed') => void
  friction?: number
  threshold?: number
  gestureEnabled?: boolean
  dragOffsetFromEdge?: number
  style?: StyleProp<ViewStyle>
  testID?: string
  ref?: Ref<SwipeableMethods>
  onSwipeStart?: () => void
  onSwipeStateChange?: (state: 'open' | 'closed') => void
  onSwipeEnd?: (state: 'open' | 'closed') => void
  onProgress?: (progress: number) => void
  autoClose?: boolean
  autoCloseTimeout?: number
  recyclingKey?: string | number
}

export interface SwipeableMethods {
  close: (animated?: boolean) => void
  /** Open the requested physical edge; without a side, prefer enabled right, then left. */
  open: (side?: SwipeSide) => void
  cancel: () => void
}

export interface SwipeableStatic {
  open: (recyclingKey: string, side?: SwipeSide) => void
  close: (recyclingKey: string, animated?: boolean) => void
  cancel: (recyclingKey: string) => void
  closeAll: (animated?: boolean) => void
}

type LeftActionsConfiguration =
  | { leftActions: ReactNode; leftActionsWidth: number }
  | { leftActions?: null | false | undefined; leftActionsWidth?: never }

type RightActionsConfiguration =
  | { rightActions: ReactNode; rightActionsWidth: number }
  | { rightActions?: null | false | undefined; rightActionsWidth?: never }

/** The sole action API: explicit physical-edge pairs, including single-sided rows. */
export type SwipeableProps = SwipeableCommonProps &
  LeftActionsConfiguration &
  RightActionsConfiguration &
  ({ leftActions: ReactNode } | { rightActions: ReactNode })

/** Descriptive alias for the same explicit-side API, not a separate implementation. */
export type TwoSidedSwipeableProps = SwipeableProps
export type SwipeableComponentProps = SwipeableProps
