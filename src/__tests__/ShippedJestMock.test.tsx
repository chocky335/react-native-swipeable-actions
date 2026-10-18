import { fireEvent, render, screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import Swipeable from '../Swipeable'

// This suite uses the shipped jestSetup.js mock, as a consumer's tests do.
function renderRow(callbacks: Record<string, jest.Mock>) {
  return render(
    <Swipeable
      testID='row'
      recyclingKey='row'
      leftActions={<Text>Reply</Text>}
      leftActionsWidth={60}
      rightActions={<Text>Delete</Text>}
      rightActionsWidth={80}
      {...callbacks}
    >
      <Text>Message</Text>
    </Swipeable>
  )
}

describe('shipped Jest mock', () => {
  it('mounts both action rails without calling consumer lifecycle callbacks', () => {
    const callbacks = {
      onSwipeStart: jest.fn(),
      onSwipeStateChange: jest.fn(),
      onSwipeEnd: jest.fn(),
      onLeftSwipeEnd: jest.fn(),
      onRightSwipeEnd: jest.fn(),
      onProgress: jest.fn()
    }
    const view = renderRow(callbacks)
    expect(screen.getByText('Reply')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
    view.unmount()
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
  })

  it('lets a test fire native-shaped events on the row', () => {
    const callbacks = { onSwipeStart: jest.fn(), onSwipeEnd: jest.fn(), onRightSwipeEnd: jest.fn() }
    renderRow(callbacks)
    const row = screen.getByTestId('row')
    fireEvent(row, 'swipeStart', { nativeEvent: { recyclingKey: 'row', side: 'right' } })
    fireEvent(row, 'swipeEnd', {
      nativeEvent: { state: 'open', side: 'right', recyclingKey: 'row' }
    })
    expect(callbacks.onSwipeStart).toHaveBeenCalledTimes(1)
    expect(callbacks.onSwipeEnd).toHaveBeenCalledWith('open')
    expect(callbacks.onRightSwipeEnd).toHaveBeenCalledWith('open')
  })
})
