import { createElement } from 'react'
import { SwipeableActions, SwipeableActionsProps } from '../SwipeableActions'

describe('SwipeableActions', () => {
  it('is a function component', () => {
    expect(typeof SwipeableActions).toBe('function')
    expect(SwipeableActions.name).toBe('SwipeableActions')
  })

  it('renders children when provided', () => {
    const child = createElement('div', { testID: 'child' })
    const result = SwipeableActions({ children: child, actionsPosition: 'right' })
    expect(result.props.children).toBe(child)
  })

  it('sets pointerEvents to auto when children exist', () => {
    const child = createElement('div')
    const result = SwipeableActions({ children: child, actionsPosition: 'right' })
    expect(result.props.pointerEvents).toBe('auto')
  })

  it('sets pointerEvents to none when no children', () => {
    const result = SwipeableActions({ children: null, actionsPosition: 'right' })
    expect(result.props.pointerEvents).toBe('none')
  })

  it('applies trailing style when actionsPosition is right', () => {
    const result = SwipeableActions({ children: null, actionsPosition: 'right' })
    const style = result.props.style
    expect(style.justifyContent).toBe('flex-end')
  })

  it('applies leading style when actionsPosition is left', () => {
    const result = SwipeableActions({ children: null, actionsPosition: 'left' })
    const style = result.props.style
    expect(style.justifyContent).toBe('flex-start')
  })

  describe('props interface', () => {
    it('accepts children and actionsPosition props', () => {
      const props: SwipeableActionsProps = {
        children: createElement('div'),
        actionsPosition: 'left'
      }
      expect(props.actionsPosition).toBe('left')
      expect(props.children).toBeDefined()
    })
  })
})
