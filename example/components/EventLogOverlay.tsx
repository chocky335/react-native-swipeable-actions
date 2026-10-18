import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useEventLog } from '../contexts/EventLogContext'
import { colors } from '../styles'

interface EventLogOverlayProps {
  topOffset: number
}

export function EventLogOverlay({ topOffset }: EventLogOverlayProps) {
  const { enabled, counters, reset } = useEventLog()

  if (!enabled) {
    return null
  }

  return (
    <View style={[styles.container, { top: topOffset }]} pointerEvents='box-none'>
      <View style={styles.row}>
        <Text style={styles.label}>start</Text>
        <Text style={styles.value} testID='event-log-start-count'>
          {counters.startCount}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>state</Text>
        <Text style={styles.value} testID='event-log-state-change-count'>
          {counters.stateChangeCount}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>end</Text>
        <Text style={styles.value} testID='event-log-end-count'>
          {counters.endCount}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>last state</Text>
        <Text style={styles.value} testID='event-log-last-state'>
          {counters.lastState ?? 'none'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>last prog</Text>
        <Text style={styles.value} testID='event-log-last-progress'>
          {counters.lastProgress.toFixed(3)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>max prog</Text>
        <Text style={styles.value} testID='event-log-max-progress'>
          {counters.maxProgress.toFixed(3)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>monotonic</Text>
        <Text style={styles.value} testID='event-log-monotonic'>
          {counters.monotonic ? 'true' : 'false'}
        </Text>
      </View>
      <TouchableOpacity style={styles.resetButton} onPress={reset} testID='reset-event-log'>
        <Text style={styles.resetButtonText}>Reset</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 10,
    backgroundColor: colors.overlay,
    padding: 8,
    borderRadius: 8,
    zIndex: 999,
    minWidth: 130
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 1
  },
  label: {
    color: colors.hudMuted,
    fontSize: 10,
    fontFamily: 'monospace'
  },
  value: {
    color: colors.hudSuccess,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    marginLeft: 8
  },
  resetButton: {
    marginTop: 6,
    padding: 4,
    backgroundColor: colors.backgroundDark,
    borderRadius: 4,
    alignItems: 'center'
  },
  resetButtonText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontFamily: 'monospace'
  }
})
