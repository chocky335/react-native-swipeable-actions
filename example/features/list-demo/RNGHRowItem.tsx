import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { StaticMuteAction, StaticLeaveAction } from './actions'
import { RowContent } from './RowContent'
import { RNGHRowItemProps } from './types'
import { DELETE_DELAY_MS } from './utils'

export function RNGHRowItem({
  item,
  isReversed,
  onMute,
  onLeave,
  onRowPress,
  swipeableRef,
  onSwipeStart,
  onSwipeEnd
}: RNGHRowItemProps) {
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

  const renderActions = useCallback(
    () => (
      <View style={styles.actionsContainer}>
        <StaticMuteAction onPress={handleMute} />
        <StaticLeaveAction onPress={handleLeave} />
      </View>
    ),
    [handleMute, handleLeave]
  )

  // Wrap callbacks to adapt RNGH signature to our timer interface
  const handleSwipeWillOpen = useCallback(() => {
    onSwipeStart?.()
  }, [onSwipeStart])

  const handleSwipeWillClose = useCallback(() => {
    onSwipeEnd?.('closed')
  }, [onSwipeEnd])

  return (
    <ReanimatedSwipeable
      ref={swipeableRef as React.RefObject<any>}
      renderRightActions={isReversed ? undefined : renderActions}
      renderLeftActions={isReversed ? renderActions : undefined}
      overshootRight={false}
      overshootLeft={false}
      rightThreshold={40}
      leftThreshold={40}
      onSwipeableWillOpen={handleSwipeWillOpen}
      onSwipeableWillClose={handleSwipeWillClose}
    >
      <RowContent item={item} onPress={handleRowPress} />
    </ReanimatedSwipeable>
  )
}

const styles = StyleSheet.create({
  actionsContainer: {
    flexDirection: 'row'
  }
})
