import { createContext, useContext } from 'react'
import type { Implementation } from '../features/list-demo'

export interface ConfigContextValue {
  implementation: Implementation
  isReversed: boolean
  friction: number
  threshold: number
  dragOffset: number
  gestureEnabled: boolean
  useFlatList: boolean
  onBenchmarkStateChange: (running: boolean, result: string | null) => void
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider')
  return ctx
}

export const ConfigProvider = ConfigContext.Provider
