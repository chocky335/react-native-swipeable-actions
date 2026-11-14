import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'

const mockNative = createControlledNativeMock()
// A consumer's own mock of this module, written before the raw native view export.
jest.mock('../SwipeableView', () => ({
  __esModule: true,
  SwipeableModule: mockNative.SwipeableModule,
  SwipeableView: mockNative.SwipeableView
}))

it('renders through the public wrapper when a mock has no raw native view', () => {
  const Swipeable = (require('../Swipeable') as typeof import('../Swipeable')).default
  let tree: ReturnType<typeof create> | undefined
  act(() => {
    tree = create(
      <Swipeable rightActions={createElement('View')} rightActionsWidth={80}>
        {createElement('View', { testID: 'content' })}
      </Swipeable>
    )
  })
  expect(tree?.root.findAllByType(mockNative.SwipeableView)).toHaveLength(1)
  expect(tree?.root.findAll((node) => node.props.testID === 'content').length).toBeGreaterThan(0)
  act(() => tree?.unmount())
})
