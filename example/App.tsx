import { NavigationContainer, type NavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppHeader, HEADER_HEIGHT } from './components/AppHeader'
import {
  ConfigPanel,
  type DemoType,
  type SharedConfig,
  type SharedConfigCallbacks
} from './components/ConfigPanel'
import { type ConfigContextValue, ConfigProvider } from './contexts/ConfigContext'
import type { Implementation } from './features/list-demo'
import { BenchmarkHUD } from './PerformanceHUD'
import { ChatScreen, type ChatScreenRef } from './screens/ChatScreen'
import { ListScreen, type ListScreenRef } from './screens/ListScreen'
import { colors } from './styles'

type RootStackParamList = {
  List: undefined
  Chat: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

function AppContent() {
  const insets = useSafeAreaInsets()

  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null)

  // Demo selection state
  const [activeDemo, setActiveDemo] = useState<DemoType>('list')
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(true)

  // Shared config state
  const [implementation, setImplementation] = useState<Implementation>('swipeable')
  const [isReversed, setIsReversed] = useState(false)
  const [friction, setFriction] = useState(1.0)
  const [threshold, setThreshold] = useState(0.4)
  const [dragOffset, setDragOffset] = useState(0)
  const [gestureEnabled, setGestureEnabled] = useState(true)
  const [useFlatList, setUseFlatList] = useState(false)
  const [isBenchmarkRunning, setIsBenchmarkRunning] = useState(false)
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null)
  const showBenchmarkHUD = isBenchmarkRunning || Boolean(benchmarkResult)

  // Screen refs — persist across navigation since they live in AppContent
  const listScreenRef = useRef<ListScreenRef>(null)
  const chatScreenRef = useRef<ChatScreenRef>(null)

  const handleBenchmarkStateChange = useCallback((running: boolean, result: string | null) => {
    setIsBenchmarkRunning(running)
    if (result !== null) {
      setBenchmarkResult(result)
    }
  }, [])

  const configValue: ConfigContextValue = useMemo(
    () => ({
      implementation,
      isReversed,
      friction,
      threshold,
      dragOffset,
      gestureEnabled,
      useFlatList,
      onBenchmarkStateChange: handleBenchmarkStateChange
    }),
    [
      implementation,
      isReversed,
      friction,
      threshold,
      dragOffset,
      gestureEnabled,
      useFlatList,
      handleBenchmarkStateChange
    ]
  )

  const sharedConfig: SharedConfig = useMemo(
    () => ({
      implementation,
      isReversed,
      friction,
      threshold,
      dragOffset,
      gestureEnabled,
      useFlatList,
      isBenchmarkRunning,
      benchmarkResult
    }),
    [
      implementation,
      isReversed,
      friction,
      threshold,
      dragOffset,
      gestureEnabled,
      useFlatList,
      isBenchmarkRunning,
      benchmarkResult
    ]
  )

  const handleCloseAll = useCallback(() => {
    if (activeDemo === 'list') {
      listScreenRef.current?.closeAllRows()
    } else {
      chatScreenRef.current?.closeAllRows()
    }
  }, [activeDemo])

  const handleResetAll = useCallback(() => {
    if (activeDemo === 'list') {
      listScreenRef.current?.resetAllRows()
    } else {
      chatScreenRef.current?.resetAllRows()
    }
  }, [activeDemo])

  const handleBenchmark = useCallback(() => {
    setIsConfigCollapsed(true)
    setTimeout(() => {
      if (activeDemo === 'list') {
        listScreenRef.current?.startBenchmark()
      } else {
        chatScreenRef.current?.startBenchmark()
      }
    }, 100)
  }, [activeDemo])

  const handleSimulateReorder = useCallback(() => {
    listScreenRef.current?.simulateReorder()
  }, [])

  const handleSimulateRapidReorder = useCallback(() => {
    listScreenRef.current?.simulateRapidReorder()
  }, [])

  const sharedCallbacks: SharedConfigCallbacks = useMemo(
    () => ({
      onImplementationChange: setImplementation,
      onReversedChange: setIsReversed,
      onFrictionChange: setFriction,
      onThresholdChange: setThreshold,
      onDragOffsetChange: setDragOffset,
      onGestureEnabledChange: setGestureEnabled,
      onUseFlatListChange: setUseFlatList,
      onCloseAll: handleCloseAll,
      onResetAll: handleResetAll,
      onBenchmark: handleBenchmark,
      onSimulateReorder: handleSimulateReorder,
      onSimulateRapidReorder: handleSimulateRapidReorder
    }),
    [handleCloseAll, handleResetAll, handleBenchmark, handleSimulateReorder, handleSimulateRapidReorder]
  )

  const handleDemoChange = useCallback((demo: DemoType) => {
    setActiveDemo(demo)
    navigationRef.current?.navigate(demo === 'list' ? 'List' : 'Chat')
  }, [])

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

      {/* Main content area — NavigationContainer with native stack */}
      <View style={styles.flex}>
        <ConfigProvider value={configValue}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator initialRouteName='List' screenOptions={{ headerShown: false }}>
              <Stack.Screen name='List'>{() => <ListScreen ref={listScreenRef} />}</Stack.Screen>
              <Stack.Screen name='Chat'>{() => <ChatScreen ref={chatScreenRef} />}</Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </ConfigProvider>
      </View>

      {/* Config panel overlay */}
      {!isConfigCollapsed && (
        <ConfigPanel
          isCollapsed={isConfigCollapsed}
          activeDemo={activeDemo}
          onDemoChange={handleDemoChange}
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
