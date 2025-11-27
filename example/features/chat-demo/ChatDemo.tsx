import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  StyleSheet,
  Text,
  View,
  Alert,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard
} from 'react-native'
import { FlashList, FlashListRef, useBenchmark } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Swipeable } from 'react-native-swipeable-actions'
import { ChatMessage } from '../../components/ChatBubble'
import { SwipeableChatMessage } from './SwipeableChatMessage'
import { Implementation } from '../list-demo'
import { colors } from '../../styles'
import { HEADER_HEIGHT } from '../../components/AppHeader'

const MESSAGE_TEMPLATES = [
  'Hey! How are you doing?',
  "I'm doing great! Just finished that project we discussed.",
  "That's awesome! Can you send me the details?",
  "Sure, I'll send it over in a few minutes.",
  'Perfect! Looking forward to seeing it.',
  'By the way, did you see the new React Native updates?',
  'Yes! The new architecture looks promising.',
  'We should try implementing some features with it.',
  'The performance improvements are really impressive.',
  'I agree, the native modules make a big difference.'
]

const SENDERS = [
  { name: 'Alice', color: colors.senderAlice, isOutgoing: false },
  { name: 'You', color: colors.senderYou, isOutgoing: true }
]

function generateMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const sender = SENDERS[i % 2]
    const hour = 10 + Math.floor(i / 60)
    const minute = i % 60
    return {
      id: String(i + 1),
      text: MESSAGE_TEMPLATES[i % MESSAGE_TEMPLATES.length],
      sender: sender.name,
      timestamp: `${hour}:${String(minute).padStart(2, '0')} AM`,
      isOutgoing: sender.isOutgoing,
      avatarColor: sender.color
    }
  })
}

const SAMPLE_MESSAGES = generateMessages(100)

export interface ChatDemoRef {
  closeAllRows: () => void
  resetAllRows: () => void
  startBenchmark: () => void
}

export interface ChatDemoProps {
  implementation: Implementation
  isReversed: boolean
  friction: number
  threshold: number
  dragOffset: number
  onBenchmarkStateChange: (running: boolean, result: string | null) => void
}

export const ChatDemo = forwardRef<ChatDemoRef, ChatDemoProps>(function ChatDemo(
  { implementation, isReversed, friction, threshold, dragOffset, onBenchmarkStateChange },
  ref
) {
  const insets = useSafeAreaInsets()
  const [messages] = useState(SAMPLE_MESSAGES)
  const [inputText, setInputText] = useState('')
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const inputRef = useRef<TextInput>(null)
  const flashListRef = useRef<FlashListRef<ChatMessage>>(null)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true))
    const hideSub = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false))
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  const { startBenchmark, isBenchmarkRunning } = useBenchmark(
    flashListRef as React.RefObject<FlashListRef<ChatMessage>>,
    (result) => {
      if (result.js) {
        const averageFps = result.js.averageFPS.toFixed(1)
        const minFps = result.js.minFPS.toFixed(1)
        const maxFps = result.js.maxFPS.toFixed(1)
        const formattedResult = `Avg: ${averageFps} | Min: ${minFps} | Max: ${maxFps}`
        onBenchmarkStateChange(false, formattedResult)
      }
    },
    {
      repeatCount: 3,
      speedMultiplier: 1.0,
      startManually: true
    }
  )

  useImperativeHandle(
    ref,
    () => ({
      closeAllRows: () => {
        SAMPLE_MESSAGES.forEach((msg) => {
          Swipeable.close(msg.id)
        })
      },
      resetAllRows: () => {
        Swipeable.closeAll(false)
      },
      startBenchmark: () => {
        onBenchmarkStateChange(true, null)
        startBenchmark()
      }
    }),
    [onBenchmarkStateChange, startBenchmark]
  )

  const handleReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message)
    inputRef.current?.focus()
  }, [])

  const handleCancelReply = useCallback(() => {
    setReplyingTo(null)
  }, [])

  const handleBubblePress = useCallback((message: ChatMessage) => {
    Alert.alert('Message Pressed', `You tapped message from ${message.sender}`)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <SwipeableChatMessage
        message={item}
        onReply={handleReply}
        onBubblePress={handleBubblePress}
        friction={friction}
        threshold={threshold}
        dragOffsetFromEdge={dragOffset}
        isReversed={isReversed}
      />
    ),
    [handleReply, handleBubblePress, friction, threshold, dragOffset, isReversed]
  )

  const keyExtractor = useCallback((item: ChatMessage) => item.id, [])

  const getItemType = useCallback(
    (item: ChatMessage) => (item.isOutgoing ? 'chat-outgoing' : 'chat-incoming'),
    []
  )

  const handleSend = useCallback(() => {
    setInputText('')
  }, [])

  const inputContainerStyle = useMemo(
    () => [styles.inputContainer, !isKeyboardVisible && { paddingBottom: insets.bottom }],
    [isKeyboardVisible, insets.bottom]
  )

  const keyboardOffset = insets.top + HEADER_HEIGHT

  return (
    <KeyboardAvoidingView
      testID='chat-demo'
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset}
    >
      <FlashList
        ref={flashListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps='always'
        getItemType={getItemType}
      />
      {replyingTo && (
        <View style={styles.replyPreview} testID='reply-preview'>
          <View style={styles.replyPreviewContent}>
            <Text style={styles.replyPreviewSender}>{replyingTo.sender}</Text>
            <Text style={styles.replyPreviewText} numberOfLines={1}>
              {replyingTo.text}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.replyPreviewClose}
            onPress={handleCancelReply}
            testID='reply-preview-close'
          >
            <Text style={styles.replyPreviewCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={inputContainerStyle}>
        <TextInput
          ref={inputRef}
          style={styles.textInput}
          placeholder='Type a message...'
          placeholderTextColor={colors.textMuted50}
          value={inputText}
          onChangeText={setInputText}
          testID='chat-input'
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundDark
  },
  listContent: {
    paddingVertical: 8
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: colors.backgroundInput,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.borderDark
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 16,
    marginRight: 8
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  sendButtonText: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundInput,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary
  },
  replyPreviewContent: {
    flex: 1
  },
  replyPreviewSender: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600'
  },
  replyPreviewText: {
    color: colors.textMuted70,
    fontSize: 13,
    marginTop: 2
  },
  replyPreviewClose: {
    padding: 8
  },
  replyPreviewCloseText: {
    color: colors.textMuted50,
    fontSize: 16
  }
})
