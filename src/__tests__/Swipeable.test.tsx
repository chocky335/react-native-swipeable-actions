import { act, render, screen } from '@testing-library/react-native'
import { createElement } from 'react'
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
    it('exposes close and open methods', () => {
      const methods: SwipeableMethods = {
        close: jest.fn(),
        open: jest.fn()
      }
      expect(typeof methods.close).toBe('function')
      expect(typeof methods.open).toBe('function')
    })
  })

  describe('recyclingKey state sync', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      ;(SwipeableModule.isOpenByKey as jest.Mock).mockReturnValue(false)
    })

    it('calls isOpenByKey only once per fresh mount', () => {
      ;(SwipeableModule.isOpenByKey as jest.Mock).mockReturnValue(false)

      render(
        createElement(Swipeable, {
          actions: mockActions,
          actionsWidth: 80,
          recyclingKey: 'key-1',
          children: createElement('View')
        })
      )

      // isOpenByKey should be called exactly once (in useState initializer).
      // The useEffect should NOT redundantly call it again for the same key on initial mount.
      expect(SwipeableModule.isOpenByKey).toHaveBeenCalledWith('key-1')
      expect(SwipeableModule.isOpenByKey).toHaveBeenCalledTimes(1)
    })

    it('syncs hasActionsRendered when recyclingKey changes', () => {
      ;(SwipeableModule.isOpenByKey as jest.Mock).mockReturnValue(false)

      const { rerender } = render(
        createElement(Swipeable, {
          actions: mockActions,
          actionsWidth: 80,
          recyclingKey: 'key-1',
          children: createElement('View')
        })
      )

      jest.clearAllMocks()
      ;(SwipeableModule.isOpenByKey as jest.Mock).mockReturnValue(true)

      rerender(
        createElement(Swipeable, {
          actions: mockActions,
          actionsWidth: 80,
          recyclingKey: 'key-2',
          children: createElement('View')
        })
      )

      // useEffect should call isOpenByKey for the new key
      expect(SwipeableModule.isOpenByKey).toHaveBeenCalledWith('key-2')
    })

    it('renders actions immediately when useState initializer detects open key', () => {
      ;(SwipeableModule.isOpenByKey as jest.Mock).mockReturnValue(true)

      const { getByTestId } = render(
        createElement(Swipeable, {
          actions: mockActions,
          actionsWidth: 80,
          recyclingKey: 'key-1',
          testID: 'swipeable',
          children: createElement('View')
        })
      )

      // SwipeableActions should be rendered on the first render (no flash)
      expect(getByTestId('swipeable-actions')).toBeTruthy()
    })
  })
})
