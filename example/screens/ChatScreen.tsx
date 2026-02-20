import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useConfig } from '../contexts/ConfigContext'
import { ChatDemo, ChatDemoRef } from '../features/chat-demo'

export interface ChatScreenRef {
  closeAllRows: () => void
  resetAllRows: () => void
  startBenchmark: () => void
}

export const ChatScreen = forwardRef<ChatScreenRef>(function ChatScreen(_props, ref) {
  const config = useConfig()
  const chatDemoRef = useRef<ChatDemoRef>(null)

  useImperativeHandle(
    ref,
    () => ({
      closeAllRows: () => chatDemoRef.current?.closeAllRows(),
      resetAllRows: () => chatDemoRef.current?.resetAllRows(),
      startBenchmark: () => chatDemoRef.current?.startBenchmark()
    }),
    []
  )

  return (
    <ChatDemo
      ref={chatDemoRef}
      implementation={config.implementation}
      isReversed={config.isReversed}
      friction={config.friction}
      threshold={config.threshold}
      dragOffset={config.dragOffset}
      gestureEnabled={config.gestureEnabled}
      onBenchmarkStateChange={config.onBenchmarkStateChange}
    />
  )
})
