import { StyleSheet, View } from 'react-native'
import { Implementation } from '../features/list-demo'
import { colors } from '../styles'
import { ListConfigSection } from './ListConfigSection'
import { SelectionRow } from './SelectionRow'

export type DemoType = 'list' | 'chat'

export interface SharedConfig {
  implementation: Implementation
  isReversed: boolean
  friction: number
  threshold: number
  dragOffset: number
  isBenchmarkRunning: boolean
  benchmarkResult: string | null
}

export interface SharedConfigCallbacks {
  onImplementationChange: (impl: Implementation) => void
  onReversedChange: (value: boolean) => void
  onFrictionChange: (value: number) => void
  onThresholdChange: (value: number) => void
  onDragOffsetChange: (value: number) => void
  onCloseAll: () => void
  onResetAll: () => void
  onBenchmark: () => void
}

interface ConfigPanelProps {
  isCollapsed: boolean
  activeDemo: DemoType
  onDemoChange: (demo: DemoType) => void
  config: SharedConfig
  callbacks: SharedConfigCallbacks
  topOffset?: number
}

const DEMO_OPTIONS: { label: string; value: DemoType; testID: string }[] = [
  { label: 'List', value: 'list', testID: 'select-demo-list' },
  { label: 'Chat', value: 'chat', testID: 'select-demo-chat' }
]

export function ConfigPanel({
  isCollapsed,
  activeDemo,
  onDemoChange,
  config,
  callbacks,
  topOffset = 0
}: ConfigPanelProps) {
  if (isCollapsed) {
    return null
  }

  return (
    <View style={[styles.controls, styles.controlsExpanded, { top: topOffset }]}>
      <View style={styles.controlsContent}>
        <SelectionRow
          label='Demo'
          options={DEMO_OPTIONS}
          value={activeDemo}
          onChange={onDemoChange}
        />
        <ListConfigSection config={config} callbacks={callbacks} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  controls: {
    backgroundColor: colors.backgroundSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  controlsExpanded: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100
  },
  controlsContent: {
    padding: 16,
    gap: 12
  }
})
