import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { colors } from '../styles'

interface AppHeaderProps {
  title: string
  subtitle: string
  isConfigOpen: boolean
  onConfigToggle: () => void
}

export const HEADER_HEIGHT = 82

export function AppHeader({ title, subtitle, isConfigOpen, onConfigToggle }: AppHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerContent}>
        <View>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
        <TouchableOpacity
          testID='config-header'
          style={styles.configButton}
          onPress={onConfigToggle}
        >
          <Text style={styles.configButtonText}>Config</Text>
          <Text style={styles.chevron}>{isConfigOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    padding: 16,
    backgroundColor: colors.backgroundSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    height: HEADER_HEIGHT
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4
  },
  configButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.configButtonBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6
  },
  configButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary
  },
  chevron: {
    fontSize: 10,
    color: colors.textSecondary
  }
})
