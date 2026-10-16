import { createRef, useEffect } from 'react'
import { I18nManager, StyleSheet, Text, View } from 'react-native'
import { act, create } from 'react-test-renderer'
import type { SwipeableMethods, SwipeSide } from '../Swipeable.types'
import { SwipeableActions } from '../SwipeableActions'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'

const mock = createControlledNativeMock()
jest.mock('../SwipeableView', () => ({ __esModule: true, ...mock }))
const Swipeable = require('../Swipeable').default as typeof import('../Swipeable').default
let tree: ReturnType<typeof create> | undefined

afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
  jest.restoreAllMocks()
})

describe.each([false, true])('global isRTL=%s', (rtl) => {
  beforeEach(() => {
    mock.reset()
    jest.replaceProperty(I18nManager, 'isRTL', rtl)
  })

  it.each<SwipeSide>(['left', 'right'])('aligns the %s slot at its physical edge', (side) => {
    act(() => {
      tree = create(
        <SwipeableActions actionsPosition={side}>
          <Text>Action</Text>
        </SwipeableActions>
      )
    })
    const view = tree!.root.findByType(View)
    expect(StyleSheet.flatten(view.props.style).justifyContent).toBe(
      (rtl ? side === 'right' : side === 'left') ? 'flex-start' : 'flex-end'
    )
    expect(view.props.collapsable).toBe(false)
    expect(view.props.pointerEvents).toBe('auto')
  })

  it.each<SwipeSide>([
    'left',
    'right'
  ])('aligns a single-side %s container at its physical edge', (side) => {
    act(() => {
      tree = create(
        <SwipeableActions actionsPosition={side}>
          <Text>Action</Text>
        </SwipeableActions>
      )
    })
    const view = tree!.root.findByType(View)
    expect(StyleSheet.flatten(view.props.style).justifyContent).toBe(
      (rtl ? side === 'right' : side === 'left') ? 'flex-start' : 'flex-end'
    )
    expect(view.props.collapsable).toBe(false)
  })

  it.each<SwipeSide>([
    'left',
    'right'
  ])('updates translated %s labels and widths without remounting or synthetic callbacks', (side) => {
    const mounted = jest.fn()
    const unmounted = jest.fn()
    const onSwipeEnd = jest.fn()
    const onLeftSwipeEnd = jest.fn()
    const onRightSwipeEnd = jest.fn()
    function Action({ label }: { label: string }) {
      useEffect(() => {
        mounted()
        return () => {
          unmounted()
        }
      }, [])
      return <Text>{label}</Text>
    }
    const row = (translated: boolean) => (
      <Swipeable
        recyclingKey='rtl-row'
        leftActions={<Action label={translated ? '\u062a\u062b\u0628\u064a\u062a' : 'Pin'} />}
        leftActionsWidth={translated ? 112 : 80}
        rightActions={<Action label={translated ? '\u062d\u0630\u0641' : 'Delete'} />}
        rightActionsWidth={translated ? 160 : 120}
        onSwipeEnd={onSwipeEnd}
        onLeftSwipeEnd={onLeftSwipeEnd}
        onRightSwipeEnd={onRightSwipeEnd}
      >
        <Text>Row</Text>
      </Swipeable>
    )
    act(() => {
      tree = create(row(false))
    })
    const instance = mock.getLastInstance()
    act(() => {
      instance?.requestActions(side)
      instance?.triggerSwipeEnd('open', side)
    })
    act(() => {
      tree!.update(row(true))
    })
    expect(mock.getInstances()).toHaveLength(1)
    expect(mock.getLastInstance()).toBe(instance)
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    expect(tree!.root.findByType(Action).props.label).toBe(
      side === 'left' ? '\u062a\u062b\u0628\u064a\u062a' : '\u062d\u0630\u0641'
    )
    const native = tree!.root.findByType(mock.SwipeableView).props
    expect(native.leftActionsWidth).toBe(112)
    expect(native.rightActionsWidth).toBe(160)
    expect(onSwipeEnd.mock.calls).toEqual([['open']])
    expect(onLeftSwipeEnd.mock.calls).toEqual(side === 'left' ? [['open']] : [])
    expect(onRightSwipeEnd.mock.calls).toEqual(side === 'right' ? [['open']] : [])
    act(() => {
      instance?.triggerSwipeEnd('closed', side)
    })
    expect(onSwipeEnd.mock.calls).toEqual([['open'], ['closed']])
    expect(onLeftSwipeEnd.mock.calls).toEqual(side === 'left' ? [['open'], ['closed']] : [])
    expect(onRightSwipeEnd.mock.calls).toEqual(side === 'right' ? [['open'], ['closed']] : [])
  })

  it('hydrates physical cached sides after recycling and ignores stale translated-row events', () => {
    mock.SwipeableModule.getOpenSideByKey.mockImplementation((key) =>
      key === 'a' ? 'left' : 'right'
    )
    const onSwipeEnd = jest.fn()
    const row = (key: string) => (
      <Swipeable
        recyclingKey={key}
        leftActions={<Text>Pin</Text>}
        leftActionsWidth={112}
        rightActions={<Text>Delete</Text>}
        rightActionsWidth={160}
        onSwipeEnd={onSwipeEnd}
      >
        <Text>Row</Text>
      </Swipeable>
    )
    act(() => {
      tree = create(row('a'))
    })
    expect(tree!.root.findAllByType(Text).map((node) => node.props.children)).toEqual([
      'Pin',
      'Row'
    ])
    act(() => {
      tree!.update(row('b'))
    })
    expect(tree!.root.findAllByType(Text).map((node) => node.props.children)).toEqual([
      'Delete',
      'Row'
    ])
    const props = tree!.root.findByType(mock.SwipeableView).props
    act(() => {
      props.onActionsNeeded({ nativeEvent: { side: 'left', recyclingKey: 'a' } })
      props.onSwipeEnd({ nativeEvent: { side: 'left', state: 'open', recyclingKey: 'a' } })
    })
    expect(tree!.root.findAllByType(Text).map((node) => node.props.children)).toEqual([
      'Delete',
      'Row'
    ])
    expect(onSwipeEnd).not.toHaveBeenCalled()
    act(() => {
      tree!.update(row('a'))
    })
    expect(tree!.root.findAllByType(Text).map((node) => node.props.children)).toEqual([
      'Pin',
      'Row'
    ])
  })

  it('does not swap explicit ref/static side commands', () => {
    const ref = createRef<SwipeableMethods>()
    act(() => {
      tree = create(
        <Swipeable
          ref={ref}
          recyclingKey='rtl-row'
          leftActions={<Text>Pin</Text>}
          leftActionsWidth={80}
          rightActions={<Text>Delete</Text>}
          rightActionsWidth={120}
        >
          <Text>Row</Text>
        </Swipeable>
      )
    })
    act(() => {
      ref.current?.open('left')
      ref.current?.open('right')
      Swipeable.open('rtl-row', 'left')
      Swipeable.open('rtl-row', 'right')
    })
    expect(mock.SwipeableModule.openByKeyOnSide.mock.calls).toEqual([
      ['rtl-row', 'left'],
      ['rtl-row', 'right'],
      ['rtl-row', 'left'],
      ['rtl-row', 'right']
    ])
  })

  it('uses the shared bridge, callback arity and stable slots for a right-only row', () => {
    const ref = createRef<SwipeableMethods>()
    const onSwipeEnd = jest.fn()
    const onRightSwipeEnd = jest.fn()
    act(() => {
      tree = create(
        <Swipeable
          ref={ref}
          recyclingKey='single-side'
          rightActions={<Text>Delete</Text>}
          rightActionsWidth={120}
          onSwipeEnd={onSwipeEnd}
          onRightSwipeEnd={onRightSwipeEnd}
        >
          <Text>Row</Text>
        </Swipeable>
      )
    })
    act(() => {
      ref.current?.open()
      mock.getLastInstance()?.triggerSwipeStart()
      mock.getLastInstance()?.requestActions('right')
      mock.getLastInstance()?.triggerSwipeEnd('open', 'right')
    })
    expect(mock.SwipeableModule.openByKey.mock.calls).toEqual([['single-side']])
    expect(mock.SwipeableModule.openByKeyOnSide).not.toHaveBeenCalled()
    expect(onSwipeEnd.mock.calls).toEqual([['open']])
    expect(onRightSwipeEnd.mock.calls).toEqual([['open']])
    expect(tree!.root.findByType(mock.SwipeableView).props.leftActionsWidth).toBe(0)
    expect(tree!.root.findByType(mock.SwipeableView).props.rightActionsWidth).toBe(120)
    expect(tree!.root.findAllByType(SwipeableActions)).toHaveLength(2)
  })
})
