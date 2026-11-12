import { useNavigation } from '@react-navigation/native'
import { useCallback, useMemo, useState } from 'react'
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native'
import { SwipeToGoBack } from '../components/SwipeToGoBack'
import { colors } from '../styles'

const PAGER_HEIGHT = 200
// The pager fills the bottom band of the screen. A drag that starts there turns
// the pager and does not go back.
const PAGER_INSETS = { bottom: PAGER_HEIGHT }
const PAGES = [
  { id: 'emoji', title: 'Emoji' },
  { id: 'gif', title: 'GIF' },
  { id: 'stickers', title: 'Stickers' }
] as const
type Page = (typeof PAGES)[number]

const pageKey = (page: Page) => page.id

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

  const { width } = useWindowDimensions()
  const [pageIndex, setPageIndex] = useState(0)

  const pageFrame = useMemo(() => ({ width, height: PAGER_HEIGHT }), [width])

  const renderPage = useCallback<ListRenderItem<Page>>(
    ({ item }) => (
      <View style={pageFrame}>
        <View style={pageStyles[item.id]}>
          <Text style={styles.pageTitle}>{item.title}</Text>
          <Text style={styles.pageHint}>Swipe left or right to turn the page</Text>
        </View>
      </View>
    ),
    [pageFrame]
  )

  const getPageLayout = useCallback(
    (_: ArrayLike<Page> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index
    }),
    [width]
  )

  const handlePageSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPageIndex(Math.round(event.nativeEvent.contentOffset.x / width))
    },
    [width]
  )

  return (
    <SwipeToGoBack
      testID='swipe-back-screen'
      onBack={goBack}
      canGoBack={canGoBack}
      gestureInsets={PAGER_INSETS}
    >
      <View style={styles.content}>
        <Text testID='swipe-back-title' style={styles.title}>
          Swipe to go back
        </Text>
        <Text style={styles.body}>Swipe right anywhere above the pager to go back.</Text>
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
        <Text testID='swipe-back-page' style={styles.body}>
          {`Pager page: ${pageIndex + 1} of ${PAGES.length}`}
        </Text>
      </View>
      <FlatList
        testID='swipe-back-pager'
        style={styles.pager}
        data={PAGES}
        keyExtractor={pageKey}
        renderItem={renderPage}
        getItemLayout={getPageLayout}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handlePageSettled}
      />
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

const page = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8
} as const

const pageStyles = StyleSheet.create({
  emoji: { ...page, backgroundColor: colors.senderAlice },
  gif: { ...page, backgroundColor: colors.senderYou },
  stickers: { ...page, backgroundColor: colors.bubbleOutgoing }
})

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
  },
  pager: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: PAGER_HEIGHT
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  pageHint: {
    fontSize: 14,
    color: colors.textMuted70
  }
})
