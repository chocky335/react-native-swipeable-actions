import { createRef, useEffect } from 'react'
import { I18nManager, Text } from 'react-native'
import { act, create } from 'react-test-renderer'
import type { SwipeableMethods, SwipeableProps } from '../Swipeable.types'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'

const mock = createControlledNativeMock()
jest.mock('../SwipeableView', () => ({ __esModule: true, ...mock }))
const Swipeable = require('../Swipeable').default as typeof import('../Swipeable').default

function ActionProbe({ name }: { name: string }) {
  return <Text>{name}</Text>
}

const both: SwipeableProps = {
  children: <Text>Row</Text>,
  leftActions: <ActionProbe name='pin' />,
  leftActionsWidth: 80,
  rightActions: <ActionProbe name='delete' />,
  rightActionsWidth: 120,
  recyclingKey: 'row'
}
let tree: ReturnType<typeof create> | undefined
function render(props: SwipeableProps) {
  act(() => {
    tree = create(<Swipeable {...props} />)
  })
}
const nativeProps = () => tree?.root.findByType(mock.SwipeableView).props
const mountedActions = () => tree?.root.findAllByType(ActionProbe).map((node) => node.props.name)
const sideCommands = () => mock.SwipeableModule.openByKeyOnSide.mock.calls

beforeEach(() => mock.reset())
afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
  jest.restoreAllMocks()
})

describe('isRTL', () => {
  it('puts each side on the opposite physical edge', () => {
    render({ ...both, isRTL: true })
    expect(nativeProps().leftActionsWidth).toBe(120)
    expect(nativeProps().rightActionsWidth).toBe(80)
    act(() => mock.getLastInstance()?.requestActions('left'))
    expect(mountedActions()).toEqual(['delete'])
    act(() => mock.getLastInstance()?.requestActions('right'))
    expect(mountedActions()).toEqual(['delete', 'pin'])
  })

  it('keeps the physical sides when it is false or not set, also in a global RTL layout', () => {
    jest.replaceProperty(I18nManager, 'isRTL', true)
    for (const props of [both, { ...both, isRTL: false }]) {
      render(props)
      expect(nativeProps().leftActionsWidth).toBe(80)
      expect(nativeProps().rightActionsWidth).toBe(120)
      act(() => mock.getLastInstance()?.requestActions('left'))
      expect(mountedActions()).toEqual(['pin'])
      act(() => tree?.unmount())
    }
  })

  it('reports each native side under the name of its prop', () => {
    const onSwipeEnd = jest.fn()
    const onLeftSwipeEnd = jest.fn()
    const onRightSwipeEnd = jest.fn()
    render({ ...both, isRTL: true, onSwipeEnd, onLeftSwipeEnd, onRightSwipeEnd })
    act(() => mock.getLastInstance()?.triggerSwipeEnd('open', 'left'))
    expect(onSwipeEnd.mock.calls).toEqual([['open']])
    expect(onRightSwipeEnd.mock.calls).toEqual([['open']])
    expect(onLeftSwipeEnd).not.toHaveBeenCalled()
    act(() => mock.getLastInstance()?.triggerSwipeEnd('closed', 'right'))
    expect(onLeftSwipeEnd.mock.calls).toEqual([['closed']])
    expect(onRightSwipeEnd.mock.calls).toEqual([['open']])
  })

  it('mirrors the side of ref and static open commands', () => {
    const ref = createRef<SwipeableMethods>()
    render({ ...both, isRTL: true, ref })
    act(() => {
      ref.current?.open('left')
      ref.current?.open('right')
      Swipeable.open('row', 'left')
      Swipeable.open('row', 'right')
    })
    expect(sideCommands()).toEqual([
      ['row', 'right'],
      ['row', 'left'],
      ['row', 'right'],
      ['row', 'left']
    ])
  })

  it('opens the right side first for a command with no side, then the only enabled side', () => {
    const ref = createRef<SwipeableMethods>()
    render({ ...both, isRTL: true, ref })
    act(() => {
      ref.current?.open()
      Swipeable.open('row')
    })
    expect(sideCommands()).toEqual([
      ['row', 'left'],
      ['row', 'left']
    ])
    expect(mock.SwipeableModule.openByKey).not.toHaveBeenCalled()

    mock.SwipeableModule.openByKeyOnSide.mockClear()
    act(() => tree?.update(<Swipeable {...both} isRTL ref={ref} rightActions={null} />))
    act(() => {
      ref.current?.open()
      Swipeable.open('row')
    })
    expect(sideCommands()).toEqual([
      ['row', 'right'],
      ['row', 'right']
    ])
  })

  it('mirrors a static command from the mount effect of an earlier sibling', () => {
    function OpenOnMount() {
      useEffect(() => {
        Swipeable.open('row', 'left')
      }, [])
      return null
    }
    act(() => {
      tree = create(
        <>
          <OpenOnMount />
          <Swipeable {...both} isRTL />
        </>
      )
    })
    expect(sideCommands()).toEqual([['row', 'right']])
  })

  it('stops mirroring static commands when the row unmounts or turns isRTL off', () => {
    render({ ...both, isRTL: true })
    act(() => tree?.update(<Swipeable {...both} isRTL={false} />))
    act(() => Swipeable.open('row', 'left'))
    act(() => tree?.update(<Swipeable {...both} isRTL />))
    act(() => Swipeable.open('row', 'left'))
    act(() => tree?.unmount())
    tree = undefined
    act(() => {
      Swipeable.open('row', 'left')
      Swipeable.open('row')
    })
    expect(sideCommands()).toEqual([
      ['row', 'left'],
      ['row', 'right'],
      ['row', 'left']
    ])
    expect(mock.SwipeableModule.openByKey.mock.calls).toEqual([['row']])
  })

  it('follows the row to a new recyclingKey', () => {
    render({ ...both, isRTL: true })
    act(() => tree?.update(<Swipeable {...both} isRTL recyclingKey='next' />))
    act(() => {
      Swipeable.open('row', 'left')
      Swipeable.open('next', 'left')
    })
    expect(sideCommands()).toEqual([
      ['row', 'left'],
      ['next', 'right']
    ])
  })

  it('hydrates the cached physical side into the mirrored content', () => {
    mock.SwipeableModule.getOpenSideByKey.mockImplementation(() => 'left')
    render({ ...both, isRTL: true })
    expect(mountedActions()).toEqual(['delete'])
  })

  it('swaps the native widths when isRTL changes', () => {
    render(both)
    act(() => tree?.update(<Swipeable {...both} isRTL />))
    expect(nativeProps().leftActionsWidth).toBe(120)
    expect(nativeProps().rightActionsWidth).toBe(80)
  })

  it('mirrors the left and right gesture insets and keeps top and bottom', () => {
    const gestureInsets = { top: 1, bottom: 2, left: 3 }
    render({ ...both, isRTL: true, gestureInsets })
    expect(nativeProps().gestureInsets).toEqual({ top: 1, bottom: 2, right: 3 })
    const mirrored = nativeProps().gestureInsets
    act(() => tree?.update(<Swipeable {...both} isRTL gestureInsets={gestureInsets} />))
    expect(nativeProps().gestureInsets).toBe(mirrored)
    act(() => tree?.update(<Swipeable {...both} gestureInsets={gestureInsets} />))
    expect(nativeProps().gestureInsets).toBe(gestureInsets)
  })

  it('mirrors a side that has only a width', () => {
    const onLeftSwipeEnd = jest.fn()
    act(() => {
      tree = create(
        <Swipeable
          isRTL
          leftActionsWidth={320}
          recyclingKey='screen'
          onLeftSwipeEnd={onLeftSwipeEnd}
        >
          <Text>Screen</Text>
        </Swipeable>
      )
    })
    expect(nativeProps().leftActionsWidth).toBe(0)
    expect(nativeProps().rightActionsWidth).toBe(320)
    act(() => mock.getLastInstance()?.triggerSwipeEnd('open', 'right'))
    expect(onLeftSwipeEnd.mock.calls).toEqual([['open']])
  })
})
