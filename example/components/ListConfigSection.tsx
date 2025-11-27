import { View, Text, TouchableOpacity } from 'react-native'
import { buttonStyles, layoutStyles } from '../styles'
import { SharedConfig, SharedConfigCallbacks } from './ConfigPanel'
import { SelectionRow, SelectionOption } from './SelectionRow'
import { Implementation } from '../features/list-demo'

export interface ListConfigSectionProps {
  config: SharedConfig
  callbacks: SharedConfigCallbacks
}

const IMPLEMENTATION_OPTIONS: SelectionOption<Implementation>[] = [
  { label: 'Swipeable', value: 'swipeable', testID: 'select-swipeable' },
  { label: 'RNGH', value: 'rngh', testID: 'select-rngh' }
]

const REVERSED_OPTIONS: SelectionOption<boolean>[] = [
  { label: 'ON', value: true, testID: 'toggle-leading-on' },
  { label: 'OFF', value: false, testID: 'toggle-leading-off' }
]

const FRICTION_OPTIONS: SelectionOption<number>[] = [
  { label: '0.3', value: 0.3, testID: 'set-friction-low' },
  { label: '1.0', value: 1.0, testID: 'set-friction-normal' }
]

const THRESHOLD_OPTIONS: SelectionOption<number>[] = [
  { label: '0.2', value: 0.2, testID: 'set-threshold-low' },
  { label: '0.4', value: 0.4, testID: 'set-threshold-medium' },
  { label: '0.7', value: 0.7, testID: 'set-threshold-high' }
]

const DRAG_OFFSET_OPTIONS: SelectionOption<number>[] = [
  { label: '0', value: 0, testID: 'set-offset-zero' },
  { label: '50', value: 50, testID: 'set-offset-high' }
]

export function ListConfigSection({ config, callbacks }: ListConfigSectionProps) {
  const { implementation, isReversed, friction, threshold, dragOffset, isBenchmarkRunning } = config

  const {
    onImplementationChange,
    onReversedChange,
    onFrictionChange,
    onThresholdChange,
    onDragOffsetChange,
    onCloseAll,
    onResetAll,
    onBenchmark
  } = callbacks

  return (
    <>
      <SelectionRow
        label='Implementation'
        options={IMPLEMENTATION_OPTIONS}
        value={implementation}
        onChange={onImplementationChange}
      />

      <SelectionRow
        label='Swipe from left'
        options={REVERSED_OPTIONS}
        value={isReversed}
        onChange={onReversedChange}
      />

      <SelectionRow
        label='Friction'
        options={FRICTION_OPTIONS}
        value={friction}
        onChange={onFrictionChange}
      />

      <SelectionRow
        label='Threshold'
        options={THRESHOLD_OPTIONS}
        value={threshold}
        onChange={onThresholdChange}
      />

      <SelectionRow
        label='Drag offset'
        options={DRAG_OFFSET_OPTIONS}
        value={dragOffset}
        onChange={onDragOffsetChange}
      />

      <View style={layoutStyles.controlRow}>
        <TouchableOpacity
          testID='close-all-button'
          style={buttonStyles.closeButton}
          onPress={onCloseAll}
        >
          <Text style={buttonStyles.closeButtonText}>Close All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID='reset-all-button'
          style={buttonStyles.closeButton}
          onPress={onResetAll}
        >
          <Text style={buttonStyles.closeButtonText}>Reset All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID='run-benchmark'
          style={[
            buttonStyles.closeButton,
            buttonStyles.benchmarkButton,
            isBenchmarkRunning && buttonStyles.buttonDisabled
          ]}
          onPress={onBenchmark}
          disabled={isBenchmarkRunning}
        >
          <Text style={buttonStyles.closeButtonText}>
            {isBenchmarkRunning ? 'Running...' : 'Benchmark'}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  )
}
