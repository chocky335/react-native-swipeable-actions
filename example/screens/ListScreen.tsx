import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useConfig } from '../contexts/ConfigContext'
import { ListDemo, ListDemoRef } from '../features/list-demo'

export interface ListScreenRef {
  closeAllRows: () => void
  resetAllRows: () => void
  startBenchmark: () => void
  simulateReorder: () => void
}

export const ListScreen = forwardRef<ListScreenRef>(function ListScreen(_props, ref) {
  const config = useConfig()
  const listDemoRef = useRef<ListDemoRef>(null)

  useImperativeHandle(
    ref,
    () => ({
      closeAllRows: () => listDemoRef.current?.closeAllRows(),
      resetAllRows: () => listDemoRef.current?.resetAllRows(),
      startBenchmark: () => listDemoRef.current?.startBenchmark(),
      simulateReorder: () => listDemoRef.current?.simulateReorder()
    }),
    []
  )

  return (
    <ListDemo
      ref={listDemoRef}
      implementation={config.implementation}
      isReversed={config.isReversed}
      friction={config.friction}
      threshold={config.threshold}
      dragOffset={config.dragOffset}
      gestureEnabled={config.gestureEnabled}
      useFlatList={config.useFlatList}
      onBenchmarkStateChange={config.onBenchmarkStateChange}
    />
  )
})
