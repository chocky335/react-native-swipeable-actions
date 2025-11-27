import { forwardRef, createElement, ComponentProps } from 'react'
import { requireNativeViewManager, requireNativeModule } from 'expo-modules-core'
import { SwipeableViewProps, NativeSwipeableRef } from './Swipeable.types'

const NativeView = requireNativeViewManager<SwipeableViewProps>('Swipeable')

// Module-level functions interface
interface SwipeableNativeModule {
  openByKey: (key: string) => void
  closeByKey: (key: string, animated?: boolean) => void
  closeAll: (animated?: boolean) => void
}

export const SwipeableModule = requireNativeModule<SwipeableNativeModule>('Swipeable')

export const SwipeableView = forwardRef<NativeSwipeableRef, SwipeableViewProps>(
  function SwipeableView(props, ref) {
    return createElement(NativeView, { ...props, ref } as ComponentProps<typeof NativeView>)
  }
)
