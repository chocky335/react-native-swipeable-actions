import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { Swipeable } from 'react-native-swipeable-actions'
import { MuteAction, LeaveAction } from './actions'
import { RowContent } from './RowContent'
import { SwipeableRowItemProps } from './types'
import { DELETE_DELAY_MS } from './utils'

export function SwipeableRowItem({
  item,
  isReversed,
  onMute,
  onLeave,
  onRowPress,
  swipeableRef,
  onSwipeStart,
  onSwipeEnd,
  friction,
  threshold,
  dragOffsetFromEdge
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

  return (
    <Swipeable
      ref={swipeableRef}
      actionsPosition={isReversed ? 'left' : 'right'}
      testID={`row-${item.id}`}
      actionsWidth={144}
      actions={
        <View style={styles.actionsContainer}>
          <MuteAction onPress={handleMute} />
          <LeaveAction onPress={handleLeave} itemId={item.id} />
        </View>
      }
      onSwipeStart={onSwipeStart}
      onSwipeEnd={onSwipeEnd}
      friction={friction}
      threshold={threshold}
      dragOffsetFromEdge={dragOffsetFromEdge}
      recyclingKey={item.id}
    >
      <RowContent item={item} onPress={handleRowPress} />
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  actionsContainer: {
    flexDirection: 'row'
  }
})
