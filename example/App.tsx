import { useCallback, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AppHeader, HEADER_HEIGHT } from './components/AppHeader'
import {
  ConfigPanel,
  DemoType,
  SharedConfig,
  SharedConfigCallbacks
} from './components/ConfigPanel'
import { ListDemo, ListDemoRef, Implementation } from './features/list-demo'
import { ChatDemo, ChatDemoRef } from './features/chat-demo'
import { BenchmarkHUD } from './PerformanceHUD'
import { colors } from './styles'

function AppContent() {
  const insets = useSafeAreaInsets()

  // Demo selection state
  const [activeDemo, setActiveDemo] = useState<DemoType>('list')
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(true)

  // Shared config state
  const [implementation, setImplementation] = useState<Implementation>('swipeable')
  const [isReversed, setIsReversed] = useState(false)
  const [friction, setFriction] = useState(1.0)
  const [threshold, setThreshold] = useState(0.4)
  const [dragOffset, setDragOffset] = useState(0)
  const [isBenchmarkRunning, setIsBenchmarkRunning] = useState(false)
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null)
  const showBenchmarkHUD = isBenchmarkRunning || Boolean(benchmarkResult)

  const listDemoRef = useRef<ListDemoRef>(null)
  const chatDemoRef = useRef<ChatDemoRef>(null)

  const handleBenchmarkStateChange = useCallback((running: boolean, result: string | null) => {
    setIsBenchmarkRunning(running)
    if (result !== null) {
      setBenchmarkResult(result)
    }
  }, [])

  const sharedConfig: SharedConfig = useMemo(
    () => ({
      implementation,
      isReversed,
      friction,
      threshold,
      dragOffset,
      isBenchmarkRunning,
      benchmarkResult
    }),
    [
      implementation,
      isReversed,
      friction,
      threshold,
      dragOffset,
      isBenchmarkRunning,
      benchmarkResult
    ]
  )

  const handleCloseAll = useCallback(() => {
    if (activeDemo === 'list') {
      listDemoRef.current?.closeAllRows()
    } else {
      chatDemoRef.current?.closeAllRows()
    }
  }, [activeDemo])

  const handleResetAll = useCallback(() => {
    if (activeDemo === 'list') {
      listDemoRef.current?.resetAllRows()
    } else {
      chatDemoRef.current?.resetAllRows()
    }
  }, [activeDemo])

  const handleBenchmark = useCallback(() => {
    // Collapse config first, then start benchmark
    setIsConfigCollapsed(true)
    setTimeout(() => {
      if (activeDemo === 'list') {
        listDemoRef.current?.startBenchmark()
      } else {
        chatDemoRef.current?.startBenchmark()
      }
    }, 100)
  }, [activeDemo])

  const sharedCallbacks: SharedConfigCallbacks = useMemo(
    () => ({
      onImplementationChange: setImplementation,
      onReversedChange: setIsReversed,
      onFrictionChange: setFriction,
      onThresholdChange: setThreshold,
      onDragOffsetChange: setDragOffset,
      onCloseAll: handleCloseAll,
      onResetAll: handleResetAll,
      onBenchmark: handleBenchmark
    }),
    [handleCloseAll, handleResetAll, handleBenchmark]
  )

  const handleConfigToggle = useCallback(() => {
    setIsConfigCollapsed((prev) => !prev)
  }, [])

  const handleDismissBenchmark = useCallback(() => {
    setBenchmarkResult(null)
  }, [])

  const topSafeAreaStyle = useMemo(
    () => [styles.topSafeArea, { height: insets.top, backgroundColor: colors.backgroundSurface }],
    [insets.top]
  )

  const subtitle = `${activeDemo === 'list' ? 'List' : 'Chat'} • ${implementation === 'swipeable' ? 'Swipeable' : 'RNGH'}`

  return (
    <GestureHandlerRootView key={implementation} style={styles.container}>
      <StatusBar style='light' />

      {/* Top safe area with header color */}
      <View style={topSafeAreaStyle} />

      <AppHeader
        title='Swipeable Demo'
        subtitle={subtitle}
        isConfigOpen={!isConfigCollapsed}
        onConfigToggle={handleConfigToggle}
      />

      {/* Main content area */}
      <View style={styles.flex}>
        {activeDemo === 'list' ? (
          <ListDemo
            ref={listDemoRef}
            implementation={implementation}
            isReversed={isReversed}
            friction={friction}
            threshold={threshold}
            dragOffset={dragOffset}
            onBenchmarkStateChange={handleBenchmarkStateChange}
          />
        ) : (
          <ChatDemo
            ref={chatDemoRef}
            implementation={implementation}
            isReversed={isReversed}
            friction={friction}
            threshold={threshold}
            dragOffset={dragOffset}
            onBenchmarkStateChange={handleBenchmarkStateChange}
          />
        )}
      </View>

      {/* Config panel overlay - only rendered when open */}
      {!isConfigCollapsed && (
        <ConfigPanel
          isCollapsed={isConfigCollapsed}
          activeDemo={activeDemo}
          onDemoChange={setActiveDemo}
          config={sharedConfig}
          callbacks={sharedCallbacks}
          topOffset={insets.top + HEADER_HEIGHT}
        />
      )}

      {showBenchmarkHUD && (
        <BenchmarkHUD
          benchmarkResult={benchmarkResult}
          implementation={implementation}
          isRunning={isBenchmarkRunning}
          onDismiss={handleDismissBenchmark}
        />
      )}
    </GestureHandlerRootView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  container: {
    flex: 1,
    backgroundColor: colors.backgroundDark
  },
  topSafeArea: {
    width: '100%'
  }
})
