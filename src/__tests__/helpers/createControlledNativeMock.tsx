import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useRef,
  type ForwardRefExoticComponent,
  type RefAttributes
} from 'react'
import { View } from 'react-native'
import type { SwipeableViewProps, SwipeSide } from '../../Swipeable.types'

type SwipeState = 'open' | 'closed'

interface ControlledSwipeableInstance {
  triggerSwipeStart: () => void
  requestActions: (side: SwipeSide) => void
  triggerSwipeProgress: (progress: number, translationX?: number) => void
  triggerSwipeStateChange: (state: SwipeState) => void
  triggerSwipeEnd: (state: SwipeState, side?: SwipeSide) => void
}

interface SwipeableViewMock {
  SwipeableModule: {
    openByKey: jest.Mock
    closeByKey: jest.Mock
    closeAll: jest.Mock
    isOpenByKey: jest.Mock<boolean, [string]>
    openByKeyOnSide: jest.Mock
    getOpenSideByKey: jest.Mock<SwipeSide | null, [string]>
  }
  SwipeableView: ForwardRefExoticComponent<SwipeableViewProps & RefAttributes<NativeSwipeableRef>>
  instances: ControlledSwipeableInstance[]
  getLastInstance: () => ControlledSwipeableInstance | undefined
  getInstances: () => ControlledSwipeableInstance[]
  reset: () => void
}

type NativeSwipeableRef = {
  close: (animated?: boolean) => Promise<void>
  open: () => Promise<void>
}

export function createControlledNativeMock(): SwipeableViewMock {
  const instances: ControlledSwipeableInstance[] = []

  const SwipeableModule = {
    openByKey: jest.fn(),
    closeByKey: jest.fn(),
    closeAll: jest.fn(),
    isOpenByKey: jest.fn((_key: string) => false) as jest.Mock<boolean, [string]>,
    openByKeyOnSide: jest.fn(),
    getOpenSideByKey: jest.fn((_key: string): SwipeSide | null => null)
  }

  const SwipeableView = forwardRef<NativeSwipeableRef, SwipeableViewProps>(
    function SwipeableView(props, ref) {
      const callbacks = useRef({
        onActionsNeeded: props.onActionsNeeded,
        onSwipeStart: props.onSwipeStart,
        onSwipeProgress: props.onSwipeProgress,
        onSwipeStateChange: props.onSwipeStateChange,
        onSwipeEnd: props.onSwipeEnd
      })

      callbacks.current = {
        onActionsNeeded: props.onActionsNeeded,
        onSwipeStart: props.onSwipeStart,
        onSwipeProgress: props.onSwipeProgress,
        onSwipeStateChange: props.onSwipeStateChange,
        onSwipeEnd: props.onSwipeEnd
      }

      const instanceRef = useRef<ControlledSwipeableInstance | null>(null)

      if (!instanceRef.current) {
        instanceRef.current = {
          requestActions: (side) => {
            callbacks.current.onActionsNeeded?.({ nativeEvent: { side } })
          },
          triggerSwipeStart: () => {
            callbacks.current.onSwipeStart?.()
          },
          triggerSwipeProgress: (progress: number, translationX = 0) => {
            callbacks.current.onSwipeProgress?.({
              nativeEvent: {
                progress,
                translationX
              }
            })
          },
          triggerSwipeStateChange: (state: SwipeState) => {
            callbacks.current.onSwipeStateChange?.({
              nativeEvent: {
                state
              }
            })
          },
          triggerSwipeEnd: (state: SwipeState, side?: SwipeSide) => {
            callbacks.current.onSwipeEnd?.({
              nativeEvent: {
                state,
                ...(side ? { side } : {})
              }
            })
          }
        }
        instances.push(instanceRef.current)
      }

      useImperativeHandle(
        ref,
        () => ({
          close: jest.fn(),
          open: jest.fn()
        }),
        []
      )

      return createElement(View, props as Omit<SwipeableViewProps, 'children'>, props.children)
    }
  )

  SwipeableView.displayName = 'SwipeableView'

  return {
    SwipeableModule,
    SwipeableView,
    instances,
    getLastInstance: () => instances[instances.length - 1],
    getInstances: () => instances,
    reset: () => {
      SwipeableModule.openByKey.mockReset()
      SwipeableModule.closeByKey.mockReset()
      SwipeableModule.closeAll.mockReset()
      SwipeableModule.isOpenByKey.mockReset().mockReturnValue(false)
      SwipeableModule.openByKeyOnSide.mockReset()
      SwipeableModule.getOpenSideByKey.mockReset().mockReturnValue(null)
      instances.length = 0
    }
  }
}
