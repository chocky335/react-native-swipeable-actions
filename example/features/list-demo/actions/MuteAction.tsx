import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { colors } from '../../../styles'

export interface ActionProps {
  onPress: () => void
}

export function MuteAction({ onPress }: ActionProps) {
  return (
    <TouchableOpacity style={styles.muteButton} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.actionButtonInner]}>
        <Text style={styles.actionButtonText}>Mute</Text>
      </View>
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
