import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react'

export interface EventLogCounters {
  startCount: number
  stateChangeCount: number
  endCount: number
  lastState: 'open' | 'closed' | null
  lastProgress: number
  maxProgress: number
  minProgress: number
  monotonic: boolean
}

const initialCounters: EventLogCounters = {
  startCount: 0,
  stateChangeCount: 0,
  endCount: 0,
  lastState: null,
  lastProgress: 0,
  maxProgress: 0,
  minProgress: 0,
  monotonic: true
}

export interface EventLogContextValue {
  enabled: boolean
  counters: EventLogCounters
  recordStart: () => void
  recordStateChange: (state: 'open' | 'closed') => void
  recordEnd: (state: 'open' | 'closed') => void
  recordProgress: (value: number) => void
  reset: () => void
}

const EventLogContext = createContext<EventLogContextValue | null>(null)

export function useEventLog(): EventLogContextValue {
  const ctx = useContext(EventLogContext)
  if (!ctx) {
    throw new Error('useEventLog must be used within EventLogProvider')
  }
  return ctx
}

interface EventLogProviderProps {
  enabled: boolean
  children: ReactNode
}

export function EventLogProvider({ enabled, children }: EventLogProviderProps) {
  const [counters, setCounters] = useState<EventLogCounters>(initialCounters)
  const progressValuesRef = useRef<number[]>([])

  const reset = useCallback(() => {
    setCounters(initialCounters)
    progressValuesRef.current = []
  }, [])

  const recordStart = useCallback(() => {
    if (!enabled) return
    progressValuesRef.current = []
    setCounters((prev) => ({
      ...prev,
      startCount: prev.startCount + 1,
      lastProgress: 0,
      maxProgress: 0,
      minProgress: 1,
      monotonic: true
    }))
  }, [enabled])

  const recordStateChange = useCallback(
    (state: 'open' | 'closed') => {
      if (!enabled) return
      setCounters((prev) => ({
        ...prev,
        stateChangeCount: prev.stateChangeCount + 1,
        lastState: state
      }))
    },
    [enabled]
  )

  const recordEnd = useCallback(
    (state: 'open' | 'closed') => {
      if (!enabled) return
      setCounters((prev) => ({
        ...prev,
        endCount: prev.endCount + 1,
        lastState: state
      }))
    },
    [enabled]
  )

  const recordProgress = useCallback(
    (value: number) => {
      if (!enabled) return
      progressValuesRef.current.push(value)
      const isMonotonic = checkMonotonic(progressValuesRef.current)
      setCounters((prevCounters) => ({
        ...prevCounters,
        lastProgress: value,
        maxProgress: Math.max(prevCounters.maxProgress, value),
        minProgress: Math.min(prevCounters.minProgress, value),
        monotonic: prevCounters.monotonic && isMonotonic
      }))
    },
    [enabled]
  )

  const value = useMemo<EventLogContextValue>(
    () => ({
      enabled,
      counters,
      recordStart,
      recordStateChange,
      recordEnd,
      recordProgress,
      reset
    }),
    [enabled, counters, recordStart, recordStateChange, recordEnd, recordProgress, reset]
  )

  return <EventLogContext.Provider value={value}>{children}</EventLogContext.Provider>
}

function checkMonotonic(values: number[]): boolean {
  if (values.length < 2) {
    return true
  }
  let isIncreasing = true
  let isDecreasing = true
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const curr = values[i]
    if (prev === undefined || curr === undefined) continue
    if (curr < prev) isIncreasing = false
    if (curr > prev) isDecreasing = false
  }
  return isIncreasing || isDecreasing
}
