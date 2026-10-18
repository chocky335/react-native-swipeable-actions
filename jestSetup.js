jest.mock('./src/SwipeableView.tsx', () => {
  const React = require('react')
  const { View } = require('react-native')

  const SwipeableModule = {
    openByKey: jest.fn(),
    closeByKey: jest.fn(),
    cancelByKey: jest.fn(),
    closeAll: jest.fn(),
    isOpenByKey: jest.fn().mockReturnValue(true),
    openByKeyOnSide: jest.fn(),
    getOpenSideByKey: jest.fn(() => null)
  }

  const SwipeableView = React.forwardRef((props, ref) => {
    const {
      children,
      onActionsNeeded,
      onSwipeStart,
      testID,
      ...rest
    } = props
    const { recyclingKey } = props

    React.useImperativeHandle(ref, () => ({
      close: jest.fn(),
      open: jest.fn(),
      cancel: jest.fn()
    }), [])

    React.useEffect(() => {
      // Match the native event shape: Swipeable reads the binding key from nativeEvent.
      const nativeEvent = (extra) => ({
        nativeEvent: { ...(recyclingKey != null ? { recyclingKey } : {}), ...extra }
      })
      onActionsNeeded?.(nativeEvent({ side: 'left' }))
      onActionsNeeded?.(nativeEvent({ side: 'right' }))
      onSwipeStart?.(nativeEvent({}))
    }, [onActionsNeeded, onSwipeStart, recyclingKey])

    return React.createElement(
      View,
      {
        testID: testID || 'SwipeableView',
        ...rest
      },
      children
    )
  })

  SwipeableView.displayName = 'SwipeableView'

  return {
    SwipeableModule,
    SwipeableView
  }
})
