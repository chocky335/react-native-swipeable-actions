import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { colors } from '../../../styles'

export interface StaticMuteActionProps {
  onPress: () => void
}

export function StaticMuteAction({ onPress }: StaticMuteActionProps) {
  return (
    <TouchableOpacity style={styles.muteButton} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.actionButtonText}>Mute</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  muteButton: {
    width: 72,
    height: '100%',
    backgroundColor: colors.warning,
    justifyContent: 'center',
    alignItems: 'center'
  },
  actionButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  }
})
