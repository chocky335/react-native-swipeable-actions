import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core'
import { type ComponentProps, createElement, forwardRef } from 'react'
import type { NativeSwipeableRef, SwipeableViewProps, SwipeSide } from './Swipeable.types'

type NativeViewProps = SwipeableViewProps & {
  /** Internal lifecycle notification; never forwarded as a consumer completion. */
  onGestureCancelled?: (event: { nativeEvent: { recyclingKey?: string } }) => void
}

const NativeView = requireNativeViewManager<NativeViewProps>('Swipeable')

// Module-level functions interface
interface SwipeableNativeModule {
  openByKey: (key: string) => void
  closeByKey: (key: string, animated?: boolean) => void
  cancelByKey: (key: string) => void
  closeAll: (animated?: boolean) => void
  isOpenByKey: (key: string) => boolean
  openByKeyOnSide: (key: string, side: SwipeSide) => void
  getOpenSideByKey: (key: string) => SwipeSide | null
}

export const SwipeableModule = requireNativeModule<SwipeableNativeModule>('Swipeable')

export const SwipeableView = forwardRef<NativeSwipeableRef, NativeViewProps>(
  function SwipeableView(props, ref) {
    return createElement(NativeView, { ...props, ref } as ComponentProps<typeof NativeView>)
  }
)

SwipeableView.displayName = 'SwipeableView'
