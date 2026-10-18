import { useCallback } from 'react'
import { type AccessibilityActionEvent, StyleSheet, View } from 'react-native'
import { Swipeable } from 'react-native-swipeable-actions'
import { LeaveAction, MuteAction } from './actions'
import { RowContent } from './RowContent'
import type { SwipeableRowItemProps } from './types'
import { DELETE_DELAY_MS } from './utils'

// The same actions as the swipe buttons, for users who cannot swipe.
const ROW_ACCESSIBILITY_ACTIONS = [
  { name: 'mute', label: 'Mute' },
  { name: 'leave', label: 'Leave' }
]

export function SwipeableRowItem({
  item,
  isReversed,
  onMute,
  onLeave,
  onRowPress,
  swipeableRef,
  onSwipeStart,
  onSwipeStateChange,
  onSwipeEnd,
  onProgress,
  friction,
  threshold,
  dragOffsetFromEdge,
  gestureEnabled
}: SwipeableRowItemProps) {
  const handleMute = useCallback(() => {
    swipeableRef.current?.close()
    setTimeout(() => onMute(item.id), DELETE_DELAY_MS)
  }, [item.id, onMute, swipeableRef])

  const handleLeave = useCallback(() => {
    swipeableRef.current?.close()
    setTimeout(() => onLeave(item.id), DELETE_DELAY_MS)
  }, [item.id, onLeave, swipeableRef])

  const handleRowPress = useCallback(() => {
    onRowPress(item.id)
  }, [item.id, onRowPress])

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'mute') handleMute()
      else if (event.nativeEvent.actionName === 'leave') handleLeave()
    },
    [handleMute, handleLeave]
  )

  const actions = (
    <View style={styles.actionsContainer}>
      <MuteAction onPress={handleMute} />
      <LeaveAction onPress={handleLeave} itemId={item.id} />
    </View>
  )
  const sideProps = isReversed
    ? { leftActions: actions, leftActionsWidth: 144 }
    : { rightActions: actions, rightActionsWidth: 144 }

  return (
    <Swipeable
      ref={swipeableRef}
      {...sideProps}
      testID={`row-${item.id}`}
      onSwipeStart={onSwipeStart}
      onSwipeStateChange={onSwipeStateChange}
      onSwipeEnd={onSwipeEnd}
      onProgress={onProgress}
      friction={friction}
      threshold={threshold}
      dragOffsetFromEdge={dragOffsetFromEdge}
      gestureEnabled={gestureEnabled}
      recyclingKey={item.id}
    >
      <RowContent
        item={item}
        onPress={handleRowPress}
        accessibilityActions={ROW_ACCESSIBILITY_ACTIONS}
        onAccessibilityAction={handleAccessibilityAction}
      />
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  actionsContainer: {
    flexDirection: 'row'
  }
})
