jest.mock('./src/SwipeableView.tsx', () => {
  const React = require('react')
  const { View } = require('react-native')

  const SwipeableModule = {
    openByKey: jest.fn(),
    closeByKey: jest.fn(),
    closeAll: jest.fn()
  }

  const SwipeableView = React.forwardRef((props, ref) => {
    const {
      children,
      onSwipeStart,
      testID,
      ...rest
    } = props

    React.useImperativeHandle(ref, () => ({
      close: jest.fn(),
      open: jest.fn()
    }), [])

    React.useEffect(() => {
      onSwipeStart?.()
    }, [onSwipeStart])

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