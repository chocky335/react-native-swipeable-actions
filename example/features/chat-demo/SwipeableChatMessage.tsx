import * as Haptics from 'expo-haptics'
import { useCallback } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { Swipeable } from 'react-native-swipeable-actions'
import { ChatBubble, type ChatMessage } from '../../components/ChatBubble'
import { REPLY_WIDTH, ReplyAction } from '../../components/ReplyAction'

export interface SwipeableChatMessageProps {
  message: ChatMessage
  onReply: (message: ChatMessage) => void
  onBubblePress: (message: ChatMessage) => void
  friction?: number
  threshold?: number
  dragOffsetFromEdge?: number
  isReversed?: boolean
  gestureEnabled?: boolean
}

export function SwipeableChatMessage({
  message,
  onReply,
  onBubblePress,
  friction = 0.8,
  threshold = 0.6,
  dragOffsetFromEdge = 0,
  isReversed = false,
  gestureEnabled
}: SwipeableChatMessageProps) {
  const progress = useSharedValue(0)

  // onSwipeStateChange: fires when gesture crosses threshold - use for haptic feedback
  // onSwipeEnd: fires when animation completes - use for reply action
  // With autoClose, onSwipeEnd still reports "open" because autoClose suppresses its own end event
  const handleSwipeStateChange = useCallback((state: 'open' | 'closed') => {
    if (state === 'open') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    }
  }, [])

  const handleSwipeEnd = useCallback(
    (state: 'open' | 'closed') => {
      if (state === 'open') {
        onReply(message)
      }
    },
    [message, onReply]
  )

  const handleBubblePress = useCallback(() => {
    onBubblePress(message)
  }, [message, onBubblePress])
  const setProgress = useCallback(
    (value: number) => {
      progress.value = value
    },
    [progress]
  )

  // An outgoing message replies from the right edge, an incoming one from the left edge.
  // `isRTL` mirrors both, so the reversed demo needs no side mapping here.
  const action = <ReplyAction progress={progress} />
  const sideProps = message.isOutgoing
    ? { rightActions: action, rightActionsWidth: REPLY_WIDTH }
    : { leftActions: action, leftActionsWidth: REPLY_WIDTH }

  return (
    <Swipeable
      {...sideProps}
      isRTL={isReversed}
      threshold={threshold}
      friction={friction}
      dragOffsetFromEdge={dragOffsetFromEdge}
      gestureEnabled={gestureEnabled}
      autoClose={true}
      onProgress={setProgress}
      onSwipeStateChange={handleSwipeStateChange}
      onSwipeEnd={handleSwipeEnd}
      recyclingKey={message.id}
      testID={`swipeable-message-${message.id}`}
    >
      <ChatBubble message={message} onPress={handleBubblePress} />
    </Swipeable>
  )
}
