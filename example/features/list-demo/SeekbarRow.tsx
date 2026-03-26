import { StyleSheet, View, Text } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated'
import { Swipeable } from 'react-native-swipeable-actions'
import { colors } from '../../styles'

const TRACK_WIDTH = 200
const THUMB_SIZE = 28

function SeekbarActions() {
  return (
    <View style={styles.actionsContainer}>
      <View style={styles.actionButton} testID='seekbar-action'>
        <Text style={styles.actionText}>Action</Text>
      </View>
    </View>
  )
}

interface SeekbarRowProps {
  isReversed: boolean
  friction: number
  threshold: number
  dragOffsetFromEdge: number
  gestureEnabled: boolean
}

export function SeekbarRow({
  isReversed,
  friction,
  threshold,
  dragOffsetFromEdge,
  gestureEnabled
}: SeekbarRowProps) {
  const thumbX = useSharedValue(TRACK_WIDTH - THUMB_SIZE)
  const startX = useSharedValue(0)

  const pan = Gesture.Pan()
    .onStart(() => {
      'worklet'
      startX.value = thumbX.value
    })
    .onUpdate((e) => {
      'worklet'
      thumbX.value = Math.max(0, Math.min(TRACK_WIDTH - THUMB_SIZE, startX.value + e.translationX))
    })
    .activeOffsetX([-5, 5])

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }]
  }))

  return (
    <View testID='seekbar-row'>
      <Swipeable
        actionsPosition={isReversed ? 'left' : 'right'}
        actionsWidth={80}
        actions={<SeekbarActions />}
        friction={friction}
        threshold={threshold}
        dragOffsetFromEdge={dragOffsetFromEdge}
        gestureEnabled={gestureEnabled}
      >
        <View style={styles.rowContent}>
          <Text style={styles.label}>Seekbar</Text>

          <GestureDetector gesture={pan}>
            <Animated.View style={styles.trackHitArea}>
              <View style={styles.track}>
                <Animated.View style={[styles.thumb, thumbStyle]} testID='seekbar-thumb' />
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </Swipeable>
    </View>
  )
}

const styles = StyleSheet.create({
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.backgroundSurface,
    height: 87
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginRight: 12
  },
  trackHitArea: {
    width: TRACK_WIDTH,
    height: 48,
    justifyContent: 'center'
  },
  track: {
    width: TRACK_WIDTH,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    justifyContent: 'center'
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.primary,
    position: 'absolute'
  },
  actionsContainer: {
    flexDirection: 'row',
    height: '100%'
  },
  actionButton: {
    width: 80,
    height: '100%',
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center'
  },
  actionText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  }
})
