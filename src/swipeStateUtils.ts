import { SWIPE_PROGRESS } from './constants'

export interface SwipeState {
  wasOpen: boolean
  swipeStarted: boolean
}

export interface SwipeStateChange {
  nextState: SwipeState
  shouldEmitEnd: boolean
  /** Whether the open state changed (for onOpenChange callback) */
  openStateChanged?: boolean
  /** The new open state (true = opened, false = closed) */
  newOpenState?: boolean
}

export function isSwipeFullyOpen(progress: number): boolean {
  return progress >= SWIPE_PROGRESS.OPEN_THRESHOLD
}

export function isSwipeFullyClosed(progress: number): boolean {
  return progress <= SWIPE_PROGRESS.CLOSED_THRESHOLD
}

export function calculateSwipeStateChange(
  progress: number,
  currentState: SwipeState
): SwipeStateChange {
  const isOpen = isSwipeFullyOpen(progress)
  const isClosed = isSwipeFullyClosed(progress)

  if (!currentState.swipeStarted) {
    return { nextState: currentState, shouldEmitEnd: false }
  }

  if (isOpen && !currentState.wasOpen) {
    return {
      nextState: { wasOpen: true, swipeStarted: false },
      shouldEmitEnd: true,
      openStateChanged: true,
      newOpenState: true
    }
  }

  if (isClosed && currentState.wasOpen) {
    return {
      nextState: { wasOpen: false, swipeStarted: false },
      shouldEmitEnd: true,
      openStateChanged: true,
      newOpenState: false
    }
  }

  return { nextState: currentState, shouldEmitEnd: false }
}
