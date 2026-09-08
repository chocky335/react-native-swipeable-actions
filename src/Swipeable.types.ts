import type { ReactNode, Ref } from 'react'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

export type SwipeSide = 'left' | 'right'
export type SwipeAppearance = 'default' | 'ios26'

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
}

export interface SwipeableViewProps extends ViewProps {
  actionsWidth: number
  twoSided?: boolean
  leftActionsWidth?: number
  rightActionsWidth?: number
  onActionsNeeded?: (event: ActionsNeededEvent) => void
  appearance?: SwipeAppearance
  hapticFeedback?: boolean
  actionsPosition?: 'left' | 'right'
  friction?: number
  threshold?: number
  gestureEnabled?: boolean
  dragOffsetFromEdge?: number
  recyclingKey?: string
  onSwipeProgress?: (event: SwipeProgressEvent) => void
  onSwipeStart?: () => void
  onSwipeStateChange?: (event: SwipeStateEvent) => void
  onSwipeEnd?: (event: SwipeStateEvent) => void
  autoClose?: boolean
  autoCloseTimeout?: number
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  nativeRef?: Ref<NativeSwipeableRef>
  testID?: string
}

export interface SwipeableProps {
  children: ReactNode
  actions: ReactNode
  actionsWidth: number
  leftActions?: ReactNode
  leftActionsWidth?: number
  rightActions?: ReactNode
  rightActionsWidth?: number
  onLeftSwipeEnd?: (state: 'open' | 'closed') => void
  onRightSwipeEnd?: (state: 'open' | 'closed') => void
  appearance?: SwipeAppearance
  hapticFeedback?: boolean
  actionsPosition?: 'left' | 'right'
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
  open: (side?: SwipeSide) => void
}

export interface SwipeableStatic {
  open: (recyclingKey: string, side?: SwipeSide) => void
  close: (recyclingKey: string, animated?: boolean) => void
  closeAll: (animated?: boolean) => void
}

type LeftActionsConfiguration =
  | { leftActions: ReactNode; leftActionsWidth: number }
  | { leftActions?: null | false | undefined; leftActionsWidth?: never }

type RightActionsConfiguration =
  | { rightActions: ReactNode; rightActionsWidth: number }
  | { rightActions?: null | false | undefined; rightActionsWidth?: never }

/** Additive input type; the legacy SwipeableProps interface keeps its required members. */
export type TwoSidedSwipeableProps = Omit<
  SwipeableProps,
  | 'actions'
  | 'actionsWidth'
  | 'leftActions'
  | 'leftActionsWidth'
  | 'rightActions'
  | 'rightActionsWidth'
> & {
  actions?: ReactNode
  actionsWidth?: number
} & LeftActionsConfiguration &
  RightActionsConfiguration &
  ({ leftActions: ReactNode } | { rightActions: ReactNode })

export type SwipeableComponentProps = SwipeableProps | TwoSidedSwipeableProps
