import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'
import type { SwipeableProps } from '../Swipeable.types'

type SwipeableComponent = typeof import('../Swipeable').default

const mock = createControlledNativeMock()
jest.mock('../SwipeableView', () => ({ __esModule: true, ...mock }))

let Swipeable: SwipeableComponent
beforeAll(() => {
  Swipeable = require('../Swipeable').default
})

const contentLifecycle = { mounts: 0, unmounts: 0 }
function Content() {
  useEffect(() => {
    contentLifecycle.mounts++
    return () => {
      contentLifecycle.unmounts++
    }
  }, [])
  return createElement('View', { testID: 'content' }, 'Message')
}

const props: SwipeableProps = {
  children: <Content />,
  leftActions: createElement('View', { testID: 'left-node' }, 'Reply'),
  leftActionsWidth: 60,
  rightActions: createElement('View', { testID: 'right-node' }, 'Delete'),
  rightActionsWidth: 80,
  testID: 'row'
}

let tree: ReturnType<typeof create> | undefined
const noOverrides: Partial<SwipeableProps> = {}

const render = (overrides = noOverrides) => {
  act(() => {
    tree = create(<Swipeable {...props} {...overrides} />)
  })
}
const update = (overrides = noOverrides) => {
  act(() => {
    tree?.update(<Swipeable {...props} {...overrides} />)
  })
}

/** The testIDs of the native host's direct children, in mount order. */
const nativeChildren = () => {
  const host = tree?.toJSON() as ReactTestRendererJSON
  return (host.children ?? []).map((child) => (child as ReactTestRendererJSON).props.testID)
}
const has = (testID: string) => tree?.root.findAll((n) => n.props.testID === testID).length !== 0

beforeEach(() => {
  mock.reset()
  contentLifecycle.mounts = 0
  contentLifecycle.unmounts = 0
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
})

it('renders a closed row as the native view and the content view only', () => {
  render({ recyclingKey: 'closed' })
  expect(nativeChildren()).toEqual([undefined])
  expect(has('content')).toBe(true)
})

it('mounts both rails in front of the content when native asks for one side', () => {
  render({ recyclingKey: 'row' })
  act(() => mock.getLastInstance()?.requestActions('right'))
  expect(nativeChildren()).toEqual(['row-left-actions', 'row-right-actions', undefined])
  expect(has('right-node')).toBe(true)
  expect(has('left-node')).toBe(false)
})

it('keeps the content mounted while the rails mount and unmount', () => {
  render({ recyclingKey: 'first' })
  act(() => mock.getLastInstance()?.requestActions('left'))
  update({ recyclingKey: 'second' })
  expect(nativeChildren()).toEqual([undefined])
  expect(contentLifecycle).toEqual({ mounts: 1, unmounts: 0 })
})

it('mounts the rails in the first render of a key that the native cache has open', () => {
  mock.SwipeableModule.getOpenSideByKey.mockImplementation((key: string) =>
    key === 'open' ? 'left' : null
  )
  render({ recyclingKey: 'open' })
  expect(nativeChildren()).toEqual(['row-left-actions', 'row-right-actions', undefined])
  expect(has('left-node')).toBe(true)
})

it('keeps the rails mounted after the row closes', () => {
  render({ recyclingKey: 'row' })
  const native = mock.getLastInstance()
  act(() => {
    native?.requestActions('right')
    native?.triggerSwipeStart()
    native?.triggerSwipeEnd('closed', 'right')
  })
  expect(nativeChildren()).toEqual(['row-left-actions', 'row-right-actions', undefined])
})

it('ignores a request for a side without a width', () => {
  render({ recyclingKey: 'row', leftActionsWidth: 0 })
  act(() => mock.getLastInstance()?.requestActions('left'))
  expect(nativeChildren()).toEqual([undefined])
})

it('ignores a request from the key the row held before a recycle', () => {
  render({ recyclingKey: 'first' })
  update({ recyclingKey: 'second' })
  act(() => {
    tree?.root
      .findByType(mock.SwipeableView)
      .props.onActionsNeeded({ nativeEvent: { recyclingKey: 'first', side: 'left' } })
  })
  expect(nativeChildren()).toEqual([undefined])
})
