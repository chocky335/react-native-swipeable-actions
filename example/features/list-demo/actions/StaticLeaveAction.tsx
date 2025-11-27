import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { colors } from '../../../styles'

export interface StaticLeaveActionProps {
  onPress: () => void
}

export function StaticLeaveAction({ onPress }: StaticLeaveActionProps) {
  return (
    <TouchableOpacity style={styles.leaveButton} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.actionButtonText}>Leave</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  leaveButton: {
    width: 72,
    height: '100%',
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center'
  },
  actionButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  }
})
