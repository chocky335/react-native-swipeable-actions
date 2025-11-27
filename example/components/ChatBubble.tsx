import { useMemo } from 'react'
import { StyleSheet, Text, View, Pressable } from 'react-native'
import { colors } from '../styles'

export interface ChatMessage {
  id: string
  text: string
  sender: string
  timestamp: string
  isOutgoing: boolean
  avatarColor: string
}

interface ChatBubbleProps {
  message: ChatMessage
  onPress?: () => void
}

export function ChatBubble({ message, onPress }: ChatBubbleProps) {
  const { text, sender, timestamp, isOutgoing, avatarColor } = message

  const avatarStyle = useMemo(
    () => [styles.avatar, { backgroundColor: avatarColor }],
    [avatarColor]
  )
  const senderNameStyle = useMemo(() => [styles.senderName, { color: avatarColor }], [avatarColor])

  return (
    <Pressable
      style={[styles.container, isOutgoing ? styles.outgoing : styles.incoming]}
      onPress={onPress}
      testID={`chat-bubble-${message.id}`}
    >
      {!isOutgoing && (
        <View style={avatarStyle}>
          <Text style={styles.avatarText}>{sender.charAt(0)}</Text>
        </View>
      )}
      <View style={[styles.bubble, isOutgoing ? styles.bubbleOutgoing : styles.bubbleIncoming]}>
        {!isOutgoing && <Text style={senderNameStyle}>{sender}</Text>}
        <Text style={styles.messageText}>{text}</Text>
        <Text style={styles.timestamp}>{timestamp}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: 2,
    paddingHorizontal: 8
  },
  incoming: {
    justifyContent: 'flex-start'
  },
  outgoing: {
    justifyContent: 'flex-end'
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    alignSelf: 'flex-end',
    marginBottom: 2
  },
  avatarText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  bubble: {
    maxWidth: '75%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18
  },
  bubbleIncoming: {
    backgroundColor: colors.backgroundSurface,
    borderBottomLeftRadius: 4
  },
  bubbleOutgoing: {
    backgroundColor: colors.bubbleOutgoing,
    borderBottomRightRadius: 4
  },
  senderName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2
  },
  messageText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 20
  },
  timestamp: {
    fontSize: 11,
    color: colors.timestampGray,
    alignSelf: 'flex-end',
    marginTop: 4
  }
})
