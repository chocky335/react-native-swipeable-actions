import { SWIPE_DEFAULTS, SWIPE_PROGRESS } from '../constants'

describe('SWIPE_PROGRESS', () => {
  it('defines open threshold near 1', () => {
    expect(SWIPE_PROGRESS.OPEN_THRESHOLD).toBe(0.99)
  })

  it('defines closed threshold near 0', () => {
    expect(SWIPE_PROGRESS.CLOSED_THRESHOLD).toBe(0.01)
  })
})

describe('SWIPE_DEFAULTS', () => {
  it('sets friction to 1 for full response', () => {
    expect(SWIPE_DEFAULTS.FRICTION).toBe(1)
  })

  it('sets threshold to 40% of actions width', () => {
    expect(SWIPE_DEFAULTS.THRESHOLD).toBe(0.4)
  })

  it('sets drag offset to 0 for immediate gesture recognition', () => {
    expect(SWIPE_DEFAULTS.DRAG_OFFSET_FROM_EDGE).toBe(0)
  })

  it('does not expose the removed single-sided position default', () => {
    expect(SWIPE_DEFAULTS).not.toHaveProperty('ACTIONS_POSITION')
  })

  it('defaults gesture to enabled', () => {
    expect(SWIPE_DEFAULTS.GESTURE_ENABLED).toBe(true)
  })
})
