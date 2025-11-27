import {
  isSwipeFullyOpen,
  isSwipeFullyClosed,
  calculateSwipeStateChange,
  SwipeState
} from '../swipeStateUtils'

describe('isSwipeFullyOpen', () => {
  it('returns true for progress at threshold (0.99)', () => {
    expect(isSwipeFullyOpen(0.99)).toBe(true)
  })

  it('returns true for progress above threshold', () => {
    expect(isSwipeFullyOpen(1.0)).toBe(true)
    expect(isSwipeFullyOpen(1.2)).toBe(true)
  })

  it('returns false for progress below threshold', () => {
    expect(isSwipeFullyOpen(0.98)).toBe(false)
    expect(isSwipeFullyOpen(0.5)).toBe(false)
    expect(isSwipeFullyOpen(0)).toBe(false)
  })
})

describe('isSwipeFullyClosed', () => {
  it('returns true for progress at threshold (0.01)', () => {
    expect(isSwipeFullyClosed(0.01)).toBe(true)
  })

  it('returns true for progress below threshold', () => {
    expect(isSwipeFullyClosed(0)).toBe(true)
    expect(isSwipeFullyClosed(0.005)).toBe(true)
  })

  it('returns false for progress above threshold', () => {
    expect(isSwipeFullyClosed(0.02)).toBe(false)
    expect(isSwipeFullyClosed(0.5)).toBe(false)
    expect(isSwipeFullyClosed(1.0)).toBe(false)
  })
})

describe('calculateSwipeStateChange', () => {
  describe('when swipe has not started', () => {
    it('returns unchanged state and shouldEmitEnd=false', () => {
      const currentState: SwipeState = { wasOpen: false, swipeStarted: false }
      const result = calculateSwipeStateChange(0.5, currentState)

      expect(result.nextState).toBe(currentState)
      expect(result.shouldEmitEnd).toBe(false)
    })
  })

  describe('when swipe has started', () => {
    it('detects open transition and emits end', () => {
      const currentState: SwipeState = { wasOpen: false, swipeStarted: true }
      const result = calculateSwipeStateChange(0.99, currentState)

      expect(result.nextState).toEqual({ wasOpen: true, swipeStarted: false })
      expect(result.shouldEmitEnd).toBe(true)
    })

    it('detects close transition and emits end', () => {
      const currentState: SwipeState = { wasOpen: true, swipeStarted: true }
      const result = calculateSwipeStateChange(0.01, currentState)

      expect(result.nextState).toEqual({ wasOpen: false, swipeStarted: false })
      expect(result.shouldEmitEnd).toBe(true)
    })

    it('does not emit end for intermediate progress', () => {
      const currentState: SwipeState = { wasOpen: false, swipeStarted: true }
      const result = calculateSwipeStateChange(0.5, currentState)

      expect(result.nextState).toBe(currentState)
      expect(result.shouldEmitEnd).toBe(false)
    })

    it('does not emit end when already open and progress stays high', () => {
      const currentState: SwipeState = { wasOpen: true, swipeStarted: true }
      const result = calculateSwipeStateChange(0.99, currentState)

      expect(result.nextState).toBe(currentState)
      expect(result.shouldEmitEnd).toBe(false)
    })

    it('does not emit end when closed and progress stays low', () => {
      const currentState: SwipeState = { wasOpen: false, swipeStarted: true }
      const result = calculateSwipeStateChange(0.01, currentState)

      expect(result.nextState).toBe(currentState)
      expect(result.shouldEmitEnd).toBe(false)
    })
  })
})
