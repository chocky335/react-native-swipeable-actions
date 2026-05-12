import { render } from '@testing-library/react-native'
import { createElement, createRef } from 'react'
import Swipeable from '../Swipeable'
import type { SwipeableMethods, SwipeableProps } from '../Swipeable.types'
import { SwipeableModule } from '../SwipeableView'

const mockActions = createElement('View', { testID: 'actions' }, 'Delete')

describe('Swipeable', () => {
  it('is exported as default', () => {
    expect(Swipeable).toBeDefined()
  })

  it('is a forwardRef component', () => {
    expect(typeof Swipeable).toBe('object')
    expect(Swipeable.$$typeof).toBe(Symbol.for('react.forward_ref'))
  })

  it('has displayName set for debugging', () => {
    expect(Swipeable.displayName).toBe('Swipeable')
  })

  describe('props interface', () => {
    it('requires children, actions, and actionsWidth', () => {
      const props: SwipeableProps = {
        children: createElement('div'),
        actions: mockActions,
        actionsWidth: 80
      }
      expect(props.actionsWidth).toBe(80)
      expect(props.actions).toBe(mockActions)
    })

    it('accepts all optional props', () => {
      const onSwipeStart = jest.fn()
      const onSwipeEnd = jest.fn()
      const onProgress = jest.fn()
      const props: SwipeableProps = {
        children: createElement('div'),
        actions: mockActions,
        actionsWidth: 80,
        actionsPosition: 'left',
        friction: 0.5,
        threshold: 0.3,
        dragOffsetFromEdge: 20,
        style: { backgroundColor: 'red' },
        testID: 'swipeable-row',
        onSwipeStart,
        onSwipeEnd,
        onProgress
      }
      expect(props.actionsPosition).toBe('left')
      expect(props.friction).toBe(0.5)
      expect(props.threshold).toBe(0.3)
      expect(props.dragOffsetFromEdge).toBe(20)
      expect(props.style).toEqual({ backgroundColor: 'red' })
      expect(props.testID).toBe('swipeable-row')
      expect(props.onSwipeStart).toBe(onSwipeStart)
      expect(props.onSwipeEnd).toBe(onSwipeEnd)
      expect(props.onProgress).toBe(onProgress)
    })

    it('accepts onProgress callback', () => {
      const onProgress = jest.fn()
      const props: SwipeableProps = {
        children: createElement('div'),
        actions: mockActions,
        actionsWidth: 80,
        onProgress
      }
      // Simulate calling onProgress with a progress value
      props.onProgress?.(0.5)
      expect(onProgress).toHaveBeenCalledWith(0.5)
    })
  })

  describe('SwipeableMethods interface', () => {
    it('exposes close, open, and cancel methods', () => {
      const methods: SwipeableMethods = {
        close: jest.fn(),
        open: jest.fn(),
        cancel: jest.fn()
      }
      expect(typeof methods.close).toBe('function')
      expect(typeof methods.open).toBe('function')
      expect(typeof methods.cancel).toBe('function')
    })
  })

  describe('cancel()', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('calls native cancelByKey when invoked via ref', () => {
      const ref = createRef<SwipeableMethods>()
      render(
        createElement(
          Swipeable,
          { ref, actions: mockActions, actionsWidth: 80, recyclingKey: 'cancel-test' },
          createElement('View')
        )
      )
      ref.current?.cancel()
      expect(SwipeableModule.cancelByKey).toHaveBeenCalledWith('cancel-test')
    })

    it('warns and no-ops when called without recyclingKey', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const ref = createRef<SwipeableMethods>()
      render(
        createElement(
          Swipeable,
          { ref, actions: mockActions, actionsWidth: 80 },
          createElement('View')
        )
      )
      ref.current?.cancel()
      expect(SwipeableModule.cancelByKey).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('cancel() called without recyclingKey')
      )
      warn.mockRestore()
    })

    it('static Swipeable.cancel(key) calls native cancelByKey', () => {
      Swipeable.cancel('static-cancel-test')
      expect(SwipeableModule.cancelByKey).toHaveBeenCalledWith('static-cancel-test')
    })
  })
})
