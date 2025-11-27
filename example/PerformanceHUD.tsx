import { useMemo } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from './styles'

interface BenchmarkHUDProps {
  benchmarkResult: string | null
  implementation: string
  isRunning: boolean
  onDismiss?: () => void
}

export function BenchmarkHUD({
  benchmarkResult,
  implementation,
  isRunning,
  onDismiss
}: BenchmarkHUDProps) {
  const { top: topInset } = useSafeAreaInsets()
  const hudStyles = useMemo(() => [styles.hud, { top: topInset }], [topInset])

  // Show running indicator
  if (isRunning) {
    return (
      <View style={hudStyles}>
        <View style={styles.runningRow}>
          <ActivityIndicator size='small' color={colors.hudSuccess} />
          <Text style={styles.runningText}>Benchmarking...</Text>
        </View>
      </View>
    )
  }

  // Show results only after benchmark completes
  if (!benchmarkResult) {
    return null
  }

  return (
    <TouchableOpacity onPress={onDismiss} activeOpacity={0.8} style={hudStyles}>
      <View style={styles.hudRow}>
        <Text style={styles.label}>Impl:</Text>
        <Text style={styles.value}>{implementation}</Text>
      </View>
      <View style={styles.hudRow}>
        <Text style={styles.label}>Result:</Text>
        <Text style={styles.value}>{benchmarkResult}</Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  hud: {
    position: 'absolute',
    right: 10,
    backgroundColor: colors.overlay,
    padding: 8,
    borderRadius: 8,
    zIndex: 1000,
    minWidth: 100
  },
  hudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  runningText: {
    color: colors.hudSuccess,
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold'
  },
  label: {
    color: colors.hudMuted,
    fontSize: 11,
    fontFamily: 'monospace'
  },
  value: {
    color: colors.hudSuccess,
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    marginLeft: 8
  }
})
