import { createElement, createRef } from 'react'
import { View } from 'react-native'
import { act, create } from 'react-test-renderer'
import type { NativeSwipeableRef } from '../Swipeable.types'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'

const mock = createControlledNativeMock()
jest.unmock('../SwipeableView')
jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => mock.SwipeableModule),
  requireNativeViewManager: jest.fn(() => mock.SwipeableView)
}))

const { SwipeableView, SwipeableModule } =
  require('../SwipeableView') as typeof import('../SwipeableView')
let tree: ReturnType<typeof create> | undefined

afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
  mock.reset()
})

it('uses the existing native manager and module', () => {
  const { requireNativeViewManager, requireNativeModule } = require('expo-modules-core')
  expect(requireNativeViewManager).toHaveBeenCalledWith('Swipeable')
  expect(requireNativeModule).toHaveBeenCalledWith('Swipeable')
  expect(SwipeableModule).toBe(mock.SwipeableModule)
})

it('forwards legacy raw-view props, refs and native events through the real adapter', () => {
  const ref = createRef<NativeSwipeableRef>()
  const onSwipeStart = jest.fn()
  const onSwipeProgress = jest.fn()
  const onSwipeEnd = jest.fn()
  act(() => {
    tree = create(
      <SwipeableView
        ref={ref}
        actionsWidth={90}
        actionsPosition='left'
        onSwipeStart={onSwipeStart}
        onSwipeProgress={onSwipeProgress}
        onSwipeEnd={onSwipeEnd}
      >
        {createElement(View)}
      </SwipeableView>
    )
  })
  expect(tree?.root.findByType(mock.SwipeableView).props.actionsWidth).toBe(90)
  expect(tree?.root.findByType(mock.SwipeableView).props.actionsPosition).toBe('left')
  act(() => {
    mock.getLastInstance()?.triggerSwipeStart()
    mock.getLastInstance()?.triggerSwipeProgress(0.2, 18)
    mock.getLastInstance()?.triggerSwipeEnd('closed')
    ref.current?.close(false)
  })
  expect(ref.current?.close).toHaveBeenCalledWith(false)
  expect(onSwipeStart).toHaveBeenCalledWith()
  expect(onSwipeProgress).toHaveBeenCalledWith({ nativeEvent: { progress: 0.2, translationX: 18 } })
  expect(onSwipeEnd).toHaveBeenCalledWith({ nativeEvent: { state: 'closed' } })
})
