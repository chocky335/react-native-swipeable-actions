import { useCallback } from 'react'
import * as Haptics from 'expo-haptics'
import { Swipeable } from 'react-native-swipeable-actions'
import { ChatBubble, ChatMessage } from '../../components/ChatBubble'
import { REPLY_WIDTH, ReplyAction } from '../../components/ReplyAction'
import { useSharedValue } from 'react-native-reanimated'

export interface SwipeableChatMessageProps {
  message: ChatMessage
  onReply: (message: ChatMessage) => void
  onBubblePress: (message: ChatMessage) => void
  friction?: number
  threshold?: number
  dragOffsetFromEdge?: number
  isReversed?: boolean
}

export function SwipeableChatMessage({
  message,
  onReply,
  onBubblePress,
  friction = 0.8,
  threshold = 0.6,
  dragOffsetFromEdge = 0,
  isReversed = false
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
    [message, onBubblePress]
  )

  // Determine actions position based on isReversed and message direction
  // Default: outgoing=right, incoming=left
  // Reversed: outgoing=left, incoming=right
  const defaultPosition = message.isOutgoing ? 'right' : 'left'
  const actionsPosition = isReversed
    ? defaultPosition === 'right'
      ? 'left'
      : 'right'
    : defaultPosition

  return (
    <Swipeable
      actionsPosition={actionsPosition}
      actionsWidth={REPLY_WIDTH}
      threshold={threshold}
      friction={friction}
      dragOffsetFromEdge={dragOffsetFromEdge}
      autoClose={true}
      actions={<ReplyAction progress={progress} />}
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
