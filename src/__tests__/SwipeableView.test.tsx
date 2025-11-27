import { SwipeableView } from '../SwipeableView'

describe('SwipeableView', () => {
  it('exports SwipeableView component', () => {
    expect(SwipeableView).toBeDefined()
  })

  it('is a forwardRef component', () => {
    expect(typeof SwipeableView).toBe('object')
    expect(SwipeableView.$$typeof).toBe(Symbol.for('react.forward_ref'))
  })

  it('has render function named SwipeableView', () => {
    expect(SwipeableView.render.name).toBe('SwipeableView')
  })
})
