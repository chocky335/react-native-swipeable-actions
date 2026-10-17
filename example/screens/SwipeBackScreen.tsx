import { useNavigation } from '@react-navigation/native'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SwipeToGoBack } from '../components/SwipeToGoBack'
import { colors } from '../styles'

export function SwipeBackScreen() {
  const navigation = useNavigation()
  const [hasDraft, setHasDraft] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)

  const goBack = useCallback(() => navigation.goBack(), [navigation])

  const canGoBack = useCallback(() => {
    if (hasDraft) setIsBlocked(true)
    return !hasDraft
  }, [hasDraft])

  const toggleDraft = useCallback(() => {
    setHasDraft((previous) => !previous)
    setIsBlocked(false)
  }, [])

  const draftState = useMemo(() => ({ selected: hasDraft }), [hasDraft])

  return (
    <SwipeToGoBack testID='swipe-back-screen' onBack={goBack} canGoBack={canGoBack}>
      <View style={styles.content}>
        <Text testID='swipe-back-title' style={styles.title}>
          Swipe to go back
        </Text>
        <Text style={styles.body}>Swipe right anywhere on this screen to go back.</Text>
        <Text style={styles.body}>A short drag snaps back, and you stay here.</Text>
        <Text style={styles.body}>Turn on the unsaved draft to block the swipe.</Text>
        <Pressable
          testID='swipe-back-draft'
          accessibilityRole='button'
          accessibilityState={draftState}
          style={hasDraft ? styles.toggleOn : styles.toggleOff}
          onPress={toggleDraft}
        >
          <Text testID='swipe-back-draft-label' style={styles.toggleText}>
            {`Unsaved draft: ${hasDraft ? 'on' : 'off'}`}
          </Text>
        </Pressable>
        {isBlocked && (
          <Text testID='swipe-back-blocked' style={styles.blocked}>
            Back blocked: unsaved draft
          </Text>
        )}
      </View>
    </SwipeToGoBack>
  )
}

const toggle = {
  alignSelf: 'flex-start',
  marginTop: 8,
  paddingVertical: 8,
  paddingHorizontal: 16,
  borderRadius: 20
} as const

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: 24,
    gap: 12,
    backgroundColor: colors.backgroundDark
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  body: {
    fontSize: 16,
    color: colors.textSecondary
  },
  toggleOff: {
    ...toggle,
    backgroundColor: colors.pillInactive
  },
  toggleOn: {
    ...toggle,
    backgroundColor: colors.pillActive
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary
  },
  blocked: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.warning
  }
})
