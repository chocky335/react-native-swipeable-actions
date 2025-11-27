import { ReactNode, Ref } from 'react'
import { ViewProps, StyleProp, ViewStyle } from 'react-native'

export interface SwipeProgressEvent {
  nativeEvent: {
    progress: number
    translationX: number
  }
}

export interface SwipeStateEvent {
  nativeEvent: {
    state: 'open' | 'closed'
  }
}

export interface NativeSwipeableRef {
  close: (animated?: boolean) => Promise<void>
  open: () => Promise<void>
}

export interface SwipeableViewProps extends ViewProps {
  actionsWidth: number
  actionsPosition?: 'left' | 'right'
  friction?: number
  threshold?: number
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
  actionsPosition?: 'left' | 'right'
  friction?: number
  threshold?: number
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
  open: () => void
}

export interface SwipeableStatic {
  open: (recyclingKey: string) => void
  close: (recyclingKey: string, animated?: boolean) => void
  closeAll: (animated?: boolean) => void
}
