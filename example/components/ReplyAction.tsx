import { StyleSheet, Text } from 'react-native'
import { colors } from '../styles'
import Animated, {
  SharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation
} from 'react-native-reanimated'

interface ReplyActionProps {
  progress: SharedValue<number>
}

export const REPLY_WIDTH = 20

export function ReplyAction({ progress }: ReplyActionProps) {
  const animatedContainerStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 0.5, 1], [0, 0.7, 1], Extrapolation.CLAMP)
    const opacity = interpolate(progress.value, [0, 0.3], [0, 1], Extrapolation.CLAMP)

    return {
      transform: [{ scale }],
      opacity
    }
  })

  return (
    <Animated.View style={[styles.circle, animatedContainerStyle]}>
      <Text style={styles.icon}>{'\u21A9'}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  circle: {
    width: REPLY_WIDTH,
    height: REPLY_WIDTH,
    borderRadius: REPLY_WIDTH / 2,
    backgroundColor: colors.primaryLight,
    marginVertical: 'auto',
    marginEnd: 5
  },
  icon: {
    fontSize: 18,
    top: -5,
    color: colors.primary
  }
})
