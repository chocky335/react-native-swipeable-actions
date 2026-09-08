import { createElement, createRef } from 'react'
import { act, create } from 'react-test-renderer'
import { createControlledNativeMock } from './helpers/createControlledNativeMock'
import type { SwipeableMethods, SwipeableProps } from '../Swipeable.types'
import { SwipeableActions } from '../SwipeableActions'

type SwipeableComponent = typeof import('../Swipeable').default

const mock = createControlledNativeMock()
jest.mock('../SwipeableView', () => ({
  __esModule: true,
  ...mock
}))

let Swipeable: SwipeableComponent
beforeAll(() => {
  Swipeable = require('../Swipeable').default
})

let tree: ReturnType<typeof create> | undefined

const defaultProps: SwipeableProps = {
  children: createElement('View', { testID: 'swipeable-content' }, 'Message'),
  actions: createElement('View', { testID: 'actions' }, 'Delete'),
  actionsWidth: 80,
  testID: 'legacy-row'
}
const mockActions = defaultProps.actions
const createRow = (props: Partial<SwipeableProps> = {}) => {
  const merged = { ...defaultProps, ...props }
  let nextTree: ReturnType<typeof create>
  act(() => {
    nextTree = create(<Swipeable {...merged} />)
  })
  return nextTree
}

describe('Swipeable', () => {
  beforeEach(() => {
    mock.reset()
  })

  afterEach(() => {
    act(() => {
      tree?.unmount()
    })
    tree = undefined
  })

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

  describe('legacy runtime behavior', () => {
    it('lazily mounts actions', () => {
      tree = createRow()
      const instance = mock.getLastInstance()
      expect(instance).toBeDefined()
      expect(
        tree.root.findAll(
          (node) => node.type === SwipeableActions && node.props.testID === 'legacy-row-actions'
        )
      ).toHaveLength(0)

      act(() => {
        instance?.triggerSwipeStart()
      })

      expect(
        tree.root.findAll(
          (node) => node.type === SwipeableActions && node.props.testID === 'legacy-row-actions'
        )
      ).toHaveLength(1)
    })

    it('forwards legacy callback arity and clamped progress values', () => {
      const onSwipeStart = jest.fn()
      const onSwipeStateChange = jest.fn()
      const onSwipeEnd = jest.fn()
      const onProgress = jest.fn()

      tree = createRow({
        testID: 'legacy-callbacks',
        onSwipeStart,
        onSwipeStateChange,
        onSwipeEnd,
        onProgress
      })
      const instance = mock.getLastInstance()

      act(() => {
        instance?.triggerSwipeStart()
        instance?.triggerSwipeProgress(-1)
        instance?.triggerSwipeProgress(0.5)
        instance?.triggerSwipeProgress(2)
        instance?.triggerSwipeStateChange('open')
        instance?.triggerSwipeEnd('open')
      })

      expect(onSwipeStart).toHaveBeenCalledTimes(1)
      expect(onSwipeStart.mock.calls[0]).toHaveLength(0)
      expect(onProgress).toHaveBeenNthCalledWith(1, 0)
      expect(onProgress).toHaveBeenNthCalledWith(2, 0.5)
      expect(onProgress).toHaveBeenNthCalledWith(3, 1)
      expect(onSwipeStateChange).toHaveBeenCalledTimes(1)
      expect(onSwipeStateChange).toHaveBeenCalledWith('open')
      expect(onSwipeStateChange.mock.calls[0]).toHaveLength(1)
      expect(onSwipeEnd).toHaveBeenCalledTimes(1)
      expect(onSwipeEnd).toHaveBeenCalledWith('open')
      expect(onSwipeEnd.mock.calls[0]).toHaveLength(1)
    })

    it('keeps legacy duplicate-start guard semantics', () => {
      const onSwipeStart = jest.fn()
      tree = createRow({ testID: 'legacy-duplicate-start', onSwipeStart })
      const instance = mock.getLastInstance()

      act(() => {
        instance?.triggerSwipeStart()
        instance?.triggerSwipeStart()
      })

      expect(onSwipeStart).toHaveBeenCalledTimes(1)

      act(() => {
        instance?.triggerSwipeEnd('closed')
        instance?.triggerSwipeStart()
      })

      expect(onSwipeStart).toHaveBeenCalledTimes(2)
    })

    it('routes ref commands through native module, including numeric recycling keys', () => {
      const ref = createRef<SwipeableMethods>()
      tree = createRow({
        testID: 'legacy-ref-commands',
        recyclingKey: 8,
        ref
      })

      act(() => {
        ref.current?.open()
        ref.current?.close(true)
        ref.current?.cancel()
      })

      expect(mock.SwipeableModule.openByKey).toHaveBeenCalledWith('8')
      expect(mock.SwipeableModule.closeByKey).toHaveBeenCalledWith('8', true)
      expect(mock.SwipeableModule.cancelByKey).toHaveBeenCalledWith('8')
    })

    it('warns for ref commands without a valid recyclingKey', () => {
      const ref = createRef<SwipeableMethods>()
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

      tree = createRow({
        testID: 'legacy-ref-missing-key',
        ref
      })

      act(() => {
        ref.current?.open()
        ref.current?.close()
      })

      expect(mock.SwipeableModule.openByKey).not.toHaveBeenCalled()
      expect(mock.SwipeableModule.closeByKey).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('close() called without recyclingKey - method has no effect')
      )
      warn.mockRestore()
    })

    it('hydrates from native cache at mount and exposes static helpers', () => {
      mock.SwipeableModule.isOpenByKey.mockReturnValue(true)

      tree = createRow({
        testID: 'legacy-cache',
        recyclingKey: 'cached-key'
      })
      expect(mock.SwipeableModule.isOpenByKey).toHaveBeenCalledWith('cached-key')
      expect(
        tree.root.findAll(
          (node) => node.type === SwipeableActions && node.props.testID === 'legacy-cache-actions'
        )
      ).toHaveLength(1)

      Swipeable.open('cached-key')
      Swipeable.close('cached-key', false)
      Swipeable.closeAll()

      expect(mock.SwipeableModule.openByKey).toHaveBeenCalledWith('cached-key')
      expect(mock.SwipeableModule.closeByKey).toHaveBeenCalledWith('cached-key', false)
      expect(mock.SwipeableModule.closeAll).toHaveBeenCalledWith(undefined)
      expect(mock.SwipeableModule.closeAll).toHaveBeenCalledTimes(1)
    })
  })

  it('forwards auto-close completion state through end callback', () => {
    const onSwipeEnd = jest.fn()

    tree = createRow({
      testID: 'legacy-auto-close',
      autoClose: true,
      recyclingKey: 'auto-close-row',
      onSwipeEnd
    })
    const instance = mock.getLastInstance()

    act(() => {
      instance?.triggerSwipeEnd('open')
    })

    expect(onSwipeEnd).toHaveBeenCalledWith('open')
    expect(onSwipeEnd.mock.calls[0]).toHaveLength(1)
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
      tree = createRow({ ref, recyclingKey: 'cancel-test' })
      act(() => ref.current?.cancel())
      expect(mock.SwipeableModule.cancelByKey).toHaveBeenCalledWith('cancel-test')
    })

    it('warns and no-ops when called without recyclingKey', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const ref = createRef<SwipeableMethods>()
      tree = createRow({ ref })
      act(() => ref.current?.cancel())
      expect(mock.SwipeableModule.cancelByKey).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('cancel() called without recyclingKey')
      )
      warn.mockRestore()
    })

    it('static Swipeable.cancel(key) calls native cancelByKey', () => {
      Swipeable.cancel('static-cancel-test')
      expect(mock.SwipeableModule.cancelByKey).toHaveBeenCalledWith('static-cancel-test')
    })

    it.each([false, true])('allows a new gesture after ref cancel with twoSided=%s', (twoSided) => {
      const ref = createRef<SwipeableMethods>()
      const onSwipeStart = jest.fn()
      const onSwipeEnd = jest.fn()
      tree = createRow({
        ref,
        recyclingKey: 'cancel-gate',
        onSwipeStart,
        onSwipeEnd,
        ...(twoSided ? { leftActions: mockActions, leftActionsWidth: 80 } : {})
      })
      const instance = mock.getLastInstance()

      act(() => {
        instance?.triggerSwipeStart()
        instance?.triggerSwipeStart()
      })
      expect(onSwipeStart).toHaveBeenCalledTimes(1)

      act(() => ref.current?.cancel())
      expect(mock.SwipeableModule.cancelByKey).toHaveBeenCalledWith('cancel-gate')
      expect(onSwipeEnd).not.toHaveBeenCalled()

      act(() => instance?.triggerSwipeStart())
      expect(onSwipeStart).toHaveBeenCalledTimes(2)
      expect(onSwipeEnd).not.toHaveBeenCalled()
    })
  })
})
