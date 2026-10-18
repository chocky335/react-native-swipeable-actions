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
    // The native event props (onSwipeStart, onSwipeEnd and the others) stay on the
    // host View, so a test can fire native-shaped events with fireEvent.
    const {
      children,
      onActionsNeeded,
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
      // Mount both action rails so tests can find action content. This internal
      // request calls no consumer callback. A mount never starts a swipe.
      onActionsNeeded?.(nativeEvent({ side: 'left' }))
      onActionsNeeded?.(nativeEvent({ side: 'right' }))
    }, [onActionsNeeded, recyclingKey])

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
