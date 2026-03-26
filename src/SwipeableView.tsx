import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core'
import { type ComponentProps, createElement, forwardRef } from 'react'
import type { NativeSwipeableRef, SwipeableViewProps } from './Swipeable.types'

const NativeView = requireNativeViewManager<SwipeableViewProps>('Swipeable')

// Module-level functions interface
interface SwipeableNativeModule {
  openByKey: (key: string) => void
  closeByKey: (key: string, animated?: boolean) => void
  closeAll: (animated?: boolean) => void
  isOpenByKey: (key: string) => boolean
}

export const SwipeableModule = requireNativeModule<SwipeableNativeModule>('Swipeable')

export const SwipeableView = forwardRef<NativeSwipeableRef, SwipeableViewProps>(
  function SwipeableView(props, ref) {
    return createElement(NativeView, { ...props, ref } as ComponentProps<typeof NativeView>)
  }
)

SwipeableView.displayName = 'SwipeableView'
