import { createRef } from 'react'
import { Platform, Text } from 'react-native'
import { act, create } from 'react-test-renderer'
import type { SwipeableMethods, TwoSidedSwipeableProps } from '../Swipeable.types'
import { SwipeableActions } from '../SwipeableActions'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'

const mock = createControlledNativeMock()
jest.mock('../SwipeableView', () => ({ __esModule: true, ...mock }))
const Swipeable = require('../Swipeable').default as typeof import('../Swipeable').default

function ActionProbe({ side }: { side: string }) {
  return <Text>{side}</Text>
}

const base: TwoSidedSwipeableProps = {
  children: <Text>Row</Text>,
  leftActions: <ActionProbe side='left' />,
  leftActionsWidth: 80,
  rightActions: <ActionProbe side='right' />,
  rightActionsWidth: 120,
  recyclingKey: 'row-a',
  testID: 'two-sided-row'
}
let tree: ReturnType<typeof create> | undefined
function render(props: TwoSidedSwipeableProps = base) {
  act(() => {
    tree = create(<Swipeable {...props} />)
  })
}
function mountedSides() {
  return tree?.root.findAllByType(ActionProbe).map((node) => node.props.side)
}

beforeEach(() => mock.reset())
afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
  jest.restoreAllMocks()
})

it('mounts stable empty shells, then only the requested action subtree', () => {
  render()
  const shells = tree?.root.findAllByType(SwipeableActions)
  expect(shells).toHaveLength(2)
  expect(shells?.map((node) => node.props.testID)).toEqual([
    'two-sided-row-left-actions',
    'two-sided-row-right-actions'
  ])
  expect(mountedSides()).toEqual([])
  act(() => mock.getLastInstance()?.requestActions('left'))
  expect(mountedSides()).toEqual(['left'])
  act(() => mock.getLastInstance()?.requestActions('left'))
  expect(mountedSides()).toEqual(['left'])
  act(() => mock.getLastInstance()?.requestActions('right'))
  expect(mountedSides()).toEqual(['left', 'right'])
})

it('keeps a gesture start separate from native action-render requests', () => {
  const onSwipeStart = jest.fn()
  const ref = createRef<SwipeableMethods>()
  render({ ...base, ref, onSwipeStart })
  act(() => ref.current?.open('left'))
  expect(mock.SwipeableModule.openByKeyOnSide).toHaveBeenCalledWith('row-a', 'left')
  act(() => mock.getLastInstance()?.requestActions('left'))
  expect(mountedSides()).toEqual(['left'])
  expect(onSwipeStart).not.toHaveBeenCalled()
  act(() => mock.getLastInstance()?.triggerSwipeStart())
  expect(onSwipeStart).toHaveBeenCalledWith()
})

it('routes default and explicit side commands through the shared bridge', () => {
  const ref = createRef<SwipeableMethods>()
  render({ ...base, ref })
  act(() => {
    ref.current?.open()
    ref.current?.close(false)
  })
  Swipeable.open('row-b')
  Swipeable.open('row-b', 'right')
  expect(mock.SwipeableModule.openByKey.mock.calls).toEqual([['row-a'], ['row-b']])
  expect(mock.SwipeableModule.openByKeyOnSide.mock.calls).toEqual([['row-b', 'right']])
  expect(mock.SwipeableModule.closeByKey.mock.calls).toEqual([['row-a', false]])
})

it('delivers aggregate end first and exactly one matching side callback, including auto-close', () => {
  const calls: string[] = []
  const onSwipeEnd = jest.fn((state) => calls.push('aggregate:' + state))
  const onLeftSwipeEnd = jest.fn((state) => calls.push('left:' + state))
  const onRightSwipeEnd = jest.fn((state) => calls.push('right:' + state))
  render({ ...base, autoClose: true, onSwipeEnd, onLeftSwipeEnd, onRightSwipeEnd })
  act(() => {
    mock.getLastInstance()?.triggerSwipeProgress(0, 0)
    mock.getLastInstance()?.triggerSwipeEnd('open', 'left')
    mock.getLastInstance()?.triggerSwipeEnd('closed', 'right')
  })
  expect(calls).toEqual(['aggregate:open', 'left:open', 'aggregate:closed', 'right:closed'])
  expect(onSwipeEnd.mock.calls).toEqual([['open'], ['closed']])
  expect(onLeftSwipeEnd.mock.calls).toEqual([['open']])
  expect(onRightSwipeEnd.mock.calls).toEqual([['closed']])
})

it('does not guess a side for a two-sided event missing metadata', () => {
  const onLeftSwipeEnd = jest.fn()
  const onRightSwipeEnd = jest.fn()
  render({ ...base, onLeftSwipeEnd, onRightSwipeEnd })
  act(() => mock.getLastInstance()?.triggerSwipeEnd('open'))
  expect(onLeftSwipeEnd).not.toHaveBeenCalled()
  expect(onRightSwipeEnd).not.toHaveBeenCalled()
})

it('ignores old-row events delivered after a recycled native view is rebound', () => {
  const onSwipeEnd = jest.fn()
  const onLeftSwipeEnd = jest.fn()
  const onProgress = jest.fn()
  render({ ...base, recyclingKey: 'row-b', onSwipeEnd, onLeftSwipeEnd, onProgress })
  const props = tree?.root.findByType(mock.SwipeableView).props
  act(() => {
    props.onActionsNeeded({ nativeEvent: { side: 'left', recyclingKey: 'row-a' } })
    props.onSwipeProgress({ nativeEvent: { progress: 1, translationX: 80, recyclingKey: 'row-a' } })
    props.onSwipeEnd({ nativeEvent: { state: 'open', side: 'left', recyclingKey: 'row-a' } })
  })
  expect(mountedSides()).toEqual([])
  expect(onProgress).not.toHaveBeenCalled()
  expect(onSwipeEnd).not.toHaveBeenCalled()
  expect(onLeftSwipeEnd).not.toHaveBeenCalled()
})

it('hydrates only the cached edge and resets lazy state on key reuse', () => {
  mock.SwipeableModule.getOpenSideByKey.mockImplementation((key) =>
    key === 'row-b' ? 'right' : null
  )
  render()
  act(() => mock.getLastInstance()?.requestActions('left'))
  expect(mountedSides()).toEqual(['left'])
  act(() => tree?.update(<Swipeable {...base} recyclingKey='row-b' />))
  expect(mountedSides()).toEqual(['right'])
  act(() => tree?.update(<Swipeable {...base} recyclingKey='row-c' />))
  expect(mountedSides()).toEqual([])
})

it('removes disabled content even if that edge was previously rendered', () => {
  render()
  act(() => mock.getLastInstance()?.requestActions('left'))
  act(() => tree?.update(<Swipeable {...base} leftActions={null} />))
  expect(mountedSides()).toEqual([])
  expect(tree?.root.findByType(mock.SwipeableView).props.leftActionsWidth).toBe(0)
  act(() => mock.getLastInstance()?.requestActions('left'))
  expect(mountedSides()).toEqual([])
})

it('warns once for an unchanged invalid configuration', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  render({ ...base, leftActionsWidth: Number.NaN })
  act(() => tree?.update(<Swipeable {...base} leftActionsWidth={Number.NaN} />))
  expect(warn).toHaveBeenCalledTimes(1)
})

it('keeps default presentation and opts into iOS feedback explicitly', () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  render()
  expect(tree?.root.findByType(mock.SwipeableView).props.appearance).toBe('default')
  expect(tree?.root.findByType(mock.SwipeableView).props.hapticFeedback).toBe(false)
  act(() => tree?.update(<Swipeable {...base} appearance='ios26' />))
  expect(tree?.root.findByType(mock.SwipeableView).props.hapticFeedback).toBe(true)
  act(() => tree?.update(<Swipeable {...base} appearance='ios26' hapticFeedback={false} />))
  expect(tree?.root.findByType(mock.SwipeableView).props.hapticFeedback).toBe(false)
})

it('does not send iOS-only presentation props to Android', () => {
  jest.replaceProperty(Platform, 'OS', 'android')
  render({ ...base, appearance: 'ios26', hapticFeedback: true })
  expect(tree?.root.findByType(mock.SwipeableView).props).not.toHaveProperty('appearance')
  expect(tree?.root.findByType(mock.SwipeableView).props).not.toHaveProperty('hapticFeedback')
})

it.each([
  true,
  false
])('resets only the internal start gate after system cancellation (keyed=%s)', (keyed) => {
  const onSwipeStart = jest.fn()
  const onSwipeEnd = jest.fn()
  const onLeftSwipeEnd = jest.fn()
  const onRightSwipeEnd = jest.fn()
  const onSwipeStateChange = jest.fn()
  const onProgress = jest.fn()
  const { recyclingKey, ...unkeyed } = base
  render({
    ...(keyed ? base : unkeyed),
    onSwipeStart,
    onSwipeEnd,
    onLeftSwipeEnd,
    onRightSwipeEnd,
    onSwipeStateChange,
    onProgress
  })
  act(() => {
    mock.getLastInstance()?.triggerSwipeStart()
    mock.getLastInstance()?.triggerSwipeStart()
  })
  expect(onSwipeStart.mock.calls).toEqual([[]])
  const props = tree?.root.findByType(mock.SwipeableView).props
  act(() => props.onGestureCancelled({ nativeEvent: keyed ? { recyclingKey } : {} }))
  for (const callback of [
    onSwipeEnd,
    onLeftSwipeEnd,
    onRightSwipeEnd,
    onSwipeStateChange,
    onProgress
  ]) {
    expect(callback).not.toHaveBeenCalled()
  }
  act(() => mock.getLastInstance()?.triggerSwipeStart())
  expect(onSwipeStart.mock.calls).toEqual([[], []])
  act(() => mock.getLastInstance()?.triggerSwipeEnd('open', 'right'))
  expect(onSwipeEnd.mock.calls).toEqual([['open']])
  expect(onRightSwipeEnd.mock.calls).toEqual([['open']])
  expect(onLeftSwipeEnd).not.toHaveBeenCalled()
})

it('does not reset the current start gate for a recycled row cancellation', () => {
  const onSwipeStart = jest.fn()
  render({ ...base, recyclingKey: 'row-b', onSwipeStart })
  act(() => mock.getLastInstance()?.triggerSwipeStart())
  const props = tree?.root.findByType(mock.SwipeableView).props
  act(() => {
    props.onGestureCancelled({ nativeEvent: { recyclingKey: 'row-a' } })
    mock.getLastInstance()?.triggerSwipeStart()
  })
  expect(onSwipeStart.mock.calls).toEqual([[]])
  act(() => {
    props.onGestureCancelled({ nativeEvent: { recyclingKey: 'row-b' } })
    mock.getLastInstance()?.triggerSwipeStart()
  })
  expect(onSwipeStart.mock.calls).toEqual([[], []])
})

it.each([
  'left',
  'right'
] as const)('accepts the next %s start after width reconciliation cancels a released settle', (side) => {
  const onSwipeStart = jest.fn()
  const onSwipeEnd = jest.fn()
  const onLeftSwipeEnd = jest.fn()
  const onRightSwipeEnd = jest.fn()
  const callbacks = { onSwipeStart, onSwipeEnd, onLeftSwipeEnd, onRightSwipeEnd }
  render({ ...base, ...callbacks, autoClose: false })
  act(() => mock.getLastInstance()?.triggerSwipeStart())
  // Release has no JS event: the native completion is still pending when props change.
  act(() =>
    tree?.update(
      <Swipeable
        {...base}
        {...callbacks}
        autoClose={false}
        leftActionsWidth={95}
        rightActionsWidth={140}
      />
    )
  )
  const props = tree?.root.findByType(mock.SwipeableView).props
  act(() => props.onGestureCancelled({ nativeEvent: { recyclingKey: 'row-a' } }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
  expect(onSwipeEnd).not.toHaveBeenCalled()
  expect(onLeftSwipeEnd).not.toHaveBeenCalled()
  expect(onRightSwipeEnd).not.toHaveBeenCalled()
  act(() => mock.getLastInstance()?.triggerSwipeStart())
  expect(onSwipeStart.mock.calls).toEqual([[], []])
  act(() => mock.getLastInstance()?.triggerSwipeEnd('open', side))
  expect(onSwipeEnd.mock.calls).toEqual([['open']])
  expect((side === 'left' ? onLeftSwipeEnd : onRightSwipeEnd).mock.calls).toEqual([['open']])
  expect(side === 'left' ? onRightSwipeEnd : onLeftSwipeEnd).not.toHaveBeenCalled()
})
