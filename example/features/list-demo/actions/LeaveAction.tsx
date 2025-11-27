import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { colors } from '../../../styles'

export interface LeaveActionProps {
  onPress: () => void
  itemId: string
}

export function LeaveAction({ onPress, itemId }: LeaveActionProps) {
  return (
    <TouchableOpacity
      style={styles.leaveButton}
      onPress={onPress}
      activeOpacity={0.7}
      testID={`leave-action-${itemId}`}
      accessibilityLabel='Leave'
    >
      <View style={[styles.actionButtonInner]}>
        <Text style={styles.actionButtonText}>Leave</Text>
      </View>
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
  actionButtonInner: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  actionButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  }
})
