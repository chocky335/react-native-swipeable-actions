import { createRef } from 'react'
import { Text } from 'react-native'
import { act, create } from 'react-test-renderer'
import type { SwipeableMethods, SwipeableProps } from '../Swipeable.types'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'

const mock = createControlledNativeMock()
jest.mock('../SwipeableView', () => ({ __esModule: true, ...mock }))
const Swipeable = require('../Swipeable').default as typeof import('../Swipeable').default

const configurations: SwipeableProps[] = [
  { children: <Text>Row</Text>, leftActions: <Text>Left</Text>, leftActionsWidth: 80 },
  { children: <Text>Row</Text>, rightActions: <Text>Right</Text>, rightActionsWidth: 120 },
  {
    children: <Text>Row</Text>,
    leftActions: <Text>Left</Text>,
    leftActionsWidth: 80,
    rightActions: <Text>Right</Text>,
    rightActionsWidth: 120
  }
]
let tree: ReturnType<typeof create> | undefined
const nativeProps = () => tree!.root.findByType(mock.SwipeableView).props

beforeEach(() => mock.reset())

describe.each(configurations)('recycled event identity for configuration %#', (props) => {
  it.each([
    'onActionsNeeded',
    'onSwipeProgress',
    'onSwipeStateChange',
    'onSwipeEnd',
    'onGestureCancelled'
  ])('rejects a queued unkeyed %s after a keyed rebind', (eventName) => {
    const onSwipeStart = jest.fn()
    const onProgress = jest.fn()
    const onSwipeStateChange = jest.fn()
    const onSwipeEnd = jest.fn()
    const onLeftSwipeEnd = jest.fn()
    const onRightSwipeEnd = jest.fn()
    const callbacks = {
      onSwipeStart,
      onProgress,
      onSwipeStateChange,
      onSwipeEnd,
      onLeftSwipeEnd,
      onRightSwipeEnd
    }
    const side = props.leftActionsWidth ? 'left' : 'right'
    const payload = { side, state: 'open', progress: 0.75, translationX: 60 }
    act(() => {
      tree = create(<Swipeable {...props} {...callbacks} />)
    })
    act(() => nativeProps().onSwipeStart({ nativeEvent: {} }))
    act(() => tree?.update(<Swipeable {...props} {...callbacks} recyclingKey='replacement' />))
    act(() => nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'replacement' } }))
    act(() => {
      nativeProps()[eventName]({ nativeEvent: payload })
      nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'replacement' } })
    })
    expect(onSwipeStart.mock.calls).toEqual([[], []])
    for (const callback of [
      onProgress,
      onSwipeStateChange,
      onSwipeEnd,
      onLeftSwipeEnd,
      onRightSwipeEnd
    ]) {
      expect(callback).not.toHaveBeenCalled()
    }
    expect(tree?.root.findAllByType(Text).map((node) => node.props.children)).toEqual(['Row'])

    act(() =>
      nativeProps()[eventName]({ nativeEvent: { ...payload, recyclingKey: 'replacement' } })
    )
    if (eventName === 'onActionsNeeded') {
      expect(tree?.root.findAllByType(Text).map((node) => node.props.children)).toContain(
        side === 'left' ? 'Left' : 'Right'
      )
    }
    if (eventName === 'onSwipeProgress') expect(onProgress.mock.calls).toEqual([[0.75]])
    if (eventName === 'onSwipeStateChange')
      expect(onSwipeStateChange.mock.calls).toEqual([['open']])
    if (eventName === 'onSwipeEnd') {
      expect(onSwipeEnd.mock.calls).toEqual([['open']])
      expect((side === 'left' ? onLeftSwipeEnd : onRightSwipeEnd).mock.calls).toEqual([['open']])
      expect(side === 'left' ? onRightSwipeEnd : onLeftSwipeEnd).not.toHaveBeenCalled()
    }
    if (eventName === 'onSwipeEnd' || eventName === 'onGestureCancelled') {
      act(() => nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'replacement' } }))
      expect(onSwipeStart.mock.calls).toEqual([[], [], []])
    }
  })
})

it.each(
  configurations
)('lifecycle review rejects an old unkeyed start after keyed rebind: %#', (props) => {
  const onSwipeStart = jest.fn()
  act(() => {
    tree = create(<Swipeable {...props} onSwipeStart={onSwipeStart} />)
  })
  act(() => nativeProps().onSwipeStart({ nativeEvent: {} }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
  act(() => tree?.update(<Swipeable {...props} recyclingKey='keyed' onSwipeStart={onSwipeStart} />))
  act(() => nativeProps().onSwipeStart({ nativeEvent: {} }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
  act(() => {
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'keyed' } })
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'keyed' } })
  })
  expect(onSwipeStart.mock.calls).toEqual([[], []])
})

it.each([
  undefined,
  ''
])('lifecycle review permits a fresh native unkeyed start with key=%s', (key) => {
  const onSwipeStart = jest.fn()
  const props = configurations[0]!
  act(() => {
    tree = create(
      <Swipeable
        {...props}
        {...(key === undefined ? {} : { recyclingKey: key })}
        onSwipeStart={onSwipeStart}
      />
    )
  })
  act(() => nativeProps().onSwipeStart({ nativeEvent: {} }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
})

it.each([
  'close',
  'cancel'
] as const)('lifecycle review resets the gate after animated close then %s', (command) => {
  const props = configurations[1]!
  const onSwipeStart = jest.fn()
  const onSwipeEnd = jest.fn()
  const onRightSwipeEnd = jest.fn()
  act(() => {
    tree = create(
      <Swipeable
        {...props}
        recyclingKey='chain'
        onSwipeStart={onSwipeStart}
        onSwipeEnd={onSwipeEnd}
        onRightSwipeEnd={onRightSwipeEnd}
      />
    )
  })
  act(() => {
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'chain' } })
    Swipeable.close('chain', true)
    if (command === 'close') Swipeable.close('chain', false)
    else Swipeable.cancel('chain')
    nativeProps().onGestureCancelled({ nativeEvent: { recyclingKey: 'chain', side: 'right' } })
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'chain' } })
  })
  expect(onSwipeStart.mock.calls).toEqual([[], []])
  expect(onSwipeEnd).not.toHaveBeenCalled()
  expect(onRightSwipeEnd).not.toHaveBeenCalled()
  expect(mock.SwipeableModule.closeByKey).toHaveBeenNthCalledWith(1, 'chain', true)
  if (command === 'close')
    expect(mock.SwipeableModule.closeByKey).toHaveBeenNthCalledWith(2, 'chain', false)
  else expect(mock.SwipeableModule.cancelByKey).toHaveBeenCalledWith('chain')
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
})

it.each(
  configurations
)('rejects a queued old-key start before it can latch the replacement gate: %#', (props) => {
  const onSwipeStart = jest.fn()
  act(() => {
    tree = create(<Swipeable {...props} recyclingKey='old' onSwipeStart={onSwipeStart} />)
  })
  act(() => nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'old', side: 'right' } }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
  act(() =>
    tree!.update(<Swipeable {...props} recyclingKey='replacement' onSwipeStart={onSwipeStart} />)
  )
  act(() => nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'old', side: 'right' } }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
  act(() => {
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'replacement', side: 'right' } })
    nativeProps().onGestureCancelled({ nativeEvent: { recyclingKey: 'old' } })
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'replacement', side: 'right' } })
  })
  expect(onSwipeStart.mock.calls).toEqual([[], []])
  act(() => {
    nativeProps().onSwipeEnd({
      nativeEvent: { recyclingKey: 'replacement', state: 'closed', side: 'right' }
    })
    nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'replacement', side: 'right' } })
  })
  expect(onSwipeStart.mock.calls).toEqual([[], [], []])
})

it('rejects an old keyed start after rebinding to an unkeyed row', () => {
  const props = configurations[0]!
  const onSwipeStart = jest.fn()
  act(() => {
    tree = create(<Swipeable {...props} recyclingKey='old' onSwipeStart={onSwipeStart} />)
  })
  act(() => tree!.update(<Swipeable {...props} onSwipeStart={onSwipeStart} />))
  act(() => nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'old' } }))
  expect(onSwipeStart).not.toHaveBeenCalled()
  act(() => nativeProps().onSwipeStart({ nativeEvent: {} }))
  expect(onSwipeStart.mock.calls).toEqual([[]])
})

describe.each(configurations)('silent native abandonment for configuration %#', (props) => {
  it.each([
    'cancel',
    'close',
    'closeAll',
    'refClose'
  ] as const)('%s waits for the internal notification and never calls consumer completion', (command) => {
    const ref = createRef<SwipeableMethods>()
    const onSwipeStart = jest.fn()
    const onSwipeEnd = jest.fn()
    const onLeftSwipeEnd = jest.fn()
    const onRightSwipeEnd = jest.fn()
    const onSwipeStateChange = jest.fn()
    const onProgress = jest.fn()
    act(() => {
      tree = create(
        <Swipeable
          {...props}
          ref={ref}
          recyclingKey='row'
          onSwipeStart={onSwipeStart}
          onSwipeEnd={onSwipeEnd}
          onLeftSwipeEnd={onLeftSwipeEnd}
          onRightSwipeEnd={onRightSwipeEnd}
          onSwipeStateChange={onSwipeStateChange}
          onProgress={onProgress}
        />
      )
    })
    const start = () => nativeProps().onSwipeStart({ nativeEvent: { recyclingKey: 'row' } })
    act(() => {
      start()
      start()
    })
    expect(onSwipeStart.mock.calls).toEqual([[]])
    act(() => {
      if (command === 'cancel') Swipeable.cancel('row')
      else if (command === 'close') Swipeable.close('row', false)
      else if (command === 'closeAll') Swipeable.closeAll(false)
      else ref.current!.close(false)
      start()
    })
    expect(onSwipeStart.mock.calls).toEqual([[]])
    if (command === 'cancel') expect(mock.SwipeableModule.cancelByKey).toHaveBeenCalledWith('row')
    else if (command === 'closeAll')
      expect(mock.SwipeableModule.closeAll).toHaveBeenCalledWith(false)
    else expect(mock.SwipeableModule.closeByKey).toHaveBeenCalledWith('row', false)
    act(() => {
      nativeProps().onGestureCancelled({ nativeEvent: { recyclingKey: 'row' } })
      start()
      start()
    })
    expect(onSwipeStart.mock.calls).toEqual([[], []])
    for (const callback of [
      onSwipeEnd,
      onLeftSwipeEnd,
      onRightSwipeEnd,
      onSwipeStateChange,
      onProgress
    ]) {
      expect(callback).not.toHaveBeenCalled()
    }
  })
})
