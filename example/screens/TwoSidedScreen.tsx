import { FlashList } from '@shopify/flash-list'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  I18nManager,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Swipeable,
  type SwipeableMethods,
  type SwipeSide,
  type TwoSidedSwipeableProps
} from 'react-native-swipeable-actions'
import { colors } from '../styles'

type Tab = 'commands' | 'options' | 'recycling' | 'localization'
// Keep the existing alternate-action test ID; it no longer represents an API fallback.
type Action = SwipeSide | 'more' | 'legacy'
type Language = 'en' | 'ar'
const ACTION_LABELS = {
  en: { left: 'Pin', right: 'Del', more: '...', legacy: 'Alt' },
  ar: {
    left: '\u062a\u062b\u0628\u064a\u062a',
    right: '\u062d\u0630\u0641',
    more: '\u0627\u0644\u0645\u0632\u064a\u062f',
    legacy: '\u0628\u062f\u064a\u0644'
  }
}
let nextContentInstance = 0

// This lives inside Swipeable, so its identity also detects wrapper remounts.
function ContentIdentity({ id }: { id: number }) {
  const [instance] = useState(() => ++nextContentInstance)
  return (
    <Text testID={`two-sided-instance-${id}`} style={styles.readout}>
      Content instance {instance}
    </Text>
  )
}
type Item = { slot: number; id: number }
type Counters = {
  starts: number
  ends: number
  leftEnds: number
  rightEnds: number
  left: number
  right: number
  more: number
  legacy: number
  last: string
}

const EMPTY_COUNTERS: Counters = {
  starts: 0,
  ends: 0,
  leftEnds: 0,
  rightEnds: 0,
  left: 0,
  right: 0,
  more: 0,
  legacy: 0,
  last: 'none'
}
const INITIAL_ITEMS: Item[] = Array.from({ length: 40 }, (_, id) => ({ slot: id, id }))
// This demo swaps rows deliberately; anchoring the old first row can hide the
// new first row above the viewport and unregister its programmatic command target.
const FLASH_LIST_SCROLL_POSITION = { disabled: true }
const recyclingKey = (id: number) => `two-sided-demo-${id}`
// The slot stays stable when its recyclingKey changes, exercising A -> B -> A reuse.
const keyExtractor = (item: Item) => String(item.slot)

function Control({
  name,
  label,
  onPress,
  selected = false,
  variant = 'grid'
}: {
  name: string
  label: string
  onPress: () => void
  selected?: boolean
  variant?: 'grid' | 'tab' | 'toggle'
}) {
  const style = [
    selected ? styles.selectedControl : styles.control,
    variant === 'tab' && styles.tabControl,
    variant === 'toggle' && styles.toggleControl
  ]
  const accessibilityState = useMemo(() => ({ selected }), [selected])
  return (
    <Pressable
      testID={`two-sided-${name}`}
      accessibilityRole='button'
      accessibilityState={accessibilityState}
      style={style}
      onPress={onPress}
    >
      <Text
        testID={`two-sided-${name}-label`}
        style={[styles.controlText, variant === 'tab' && styles.tabText]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function ActionButton({
  id,
  action,
  language,
  rounded,
  onAction
}: {
  id: number
  action: Action
  language: Language
  rounded: boolean
  onAction: (id: number, action: Action) => void
}) {
  const press = useCallback(() => onAction(id, action), [id, action, onAction])
  const style = useMemo(
    () => [
      styles.action,
      action === 'left' ? styles.leftAction : styles.rightAction,
      rounded && styles.roundedAction
    ],
    [action, rounded]
  )
  const labels = ACTION_LABELS[language]
  return (
    <Pressable
      testID={`two-sided-action-${action}-${id}`}
      accessibilityRole='button'
      accessibilityLabel={`${action} action for row ${id}`}
      onPress={press}
      style={style}
    >
      <Text testID={`two-sided-action-label-${action}-${id}`} style={styles.actionText}>
        {labels[action]}
      </Text>
    </Pressable>
  )
}

function DemoRow({
  item,
  counters,
  options,
  rowRefs,
  onAction,
  onEvent
}: {
  item: Item
  counters: Counters
  options: {
    language: Language
    rightOnly: boolean
    leftEnabled: boolean
    rightEnabled: boolean
    leftWidth: number
    rightWidth: number
    gestureEnabled: boolean
    autoClose: boolean
    alternateContent: boolean
    rounded: boolean
    multiple: boolean
    light: boolean
    appearance: 'default' | 'ios26'
    haptics: 'auto' | 'on' | 'off'
  }
  rowRefs: React.RefObject<Map<number, SwipeableMethods>>
  onAction: (id: number, action: Action) => void
  onEvent: (id: number, field: 'starts' | 'ends' | 'leftEnds' | 'rightEnds', last?: string) => void
}) {
  const { id, slot } = item
  const [layoutWidth, setLayoutWidth] = useState(0)
  const recordLayout = useCallback((event: LayoutChangeEvent) => {
    setLayoutWidth(Math.round(event.nativeEvent.layout.width))
  }, [])
  const attachRef = useCallback(
    (ref: SwipeableMethods | null) => {
      if (ref) rowRefs.current.set(slot, ref)
      else rowRefs.current.delete(slot)
    },
    [rowRefs, slot]
  )
  const recordStart = useCallback(() => onEvent(id, 'starts'), [id, onEvent])
  const recordEnd = useCallback(() => onEvent(id, 'ends'), [id, onEvent])
  const recordLeftEnd = useCallback(
    (state: 'open' | 'closed') => onEvent(id, 'leftEnds', `left:${state}`),
    [id, onEvent]
  )
  const recordRightEnd = useCallback(
    (state: 'open' | 'closed') => onEvent(id, 'rightEnds', `right:${state}`),
    [id, onEvent]
  )
  const leftRailStyle = useMemo(
    () => [
      options.rounded ? styles.insetRail : styles.rail,
      { width: options.leftWidth, height: '100%' as const }
    ],
    [options.rounded, options.leftWidth]
  )
  const rightRailStyle = useMemo(
    () => [
      options.rounded ? styles.insetRail : styles.rail,
      { width: options.rightWidth, height: '100%' as const }
    ],
    [options.rounded, options.rightWidth]
  )
  const cardStyle = options.light ? styles.lightCard : styles.card
  const contentStyle = options.light ? styles.lightContent : styles.content
  const titleStyle = options.light ? styles.lightTitle : styles.title
  const readoutStyle = options.light ? styles.lightReadout : styles.readout
  const feedback = options.haptics === 'auto' ? {} : { hapticFeedback: options.haptics === 'on' }
  const sideProps = {
    ...(options.leftEnabled && !options.rightOnly
      ? {
          leftActions: (
            <View style={leftRailStyle}>
              <ActionButton
                id={id}
                action='left'
                language={options.language}
                rounded={options.rounded}
                onAction={onAction}
              />
            </View>
          ),
          leftActionsWidth: options.leftWidth
        }
      : { leftActions: null }),
    ...(options.rightEnabled
      ? {
          rightActions: (
            <View style={rightRailStyle}>
              <ActionButton
                id={id}
                action={options.alternateContent ? 'legacy' : 'right'}
                language={options.language}
                rounded={options.rounded}
                onAction={onAction}
              />
              {options.multiple && (
                <ActionButton
                  id={id}
                  action='more'
                  language={options.language}
                  rounded={options.rounded}
                  onAction={onAction}
                />
              )}
            </View>
          ),
          rightActionsWidth: options.rightWidth
        }
      : { rightActions: false as const })
  } satisfies Pick<
    TwoSidedSwipeableProps,
    'leftActions' | 'leftActionsWidth' | 'rightActions' | 'rightActionsWidth'
  >

  const commonProps = {
    ...feedback,
    appearance: options.appearance,
    ref: attachRef,
    testID: `two-sided-row-${id}`,
    recyclingKey: recyclingKey(id),
    gestureEnabled: options.gestureEnabled,
    autoClose: options.autoClose,
    autoCloseTimeout: 250,
    onSwipeStart: recordStart,
    onSwipeEnd: recordEnd,
    onLeftSwipeEnd: recordLeftEnd,
    onRightSwipeEnd: recordRightEnd
  }
  const content = (
    <View style={contentStyle} collapsable={false}>
      <Text style={titleStyle}>Row {id}</Text>
      <Text style={titleStyle}>
        Left {options.leftWidth} / Right {options.rightWidth}
      </Text>
      <ContentIdentity id={id} />
      {/* A centered, unclipped marker exposes actual native translation to E2E. */}
      <View testID={`two-sided-anchor-${id}`} collapsable={false} style={styles.anchor} />
    </View>
  )

  return (
    <View style={cardStyle}>
      <View testID={`two-sided-frame-${id}`} collapsable={false} onLayout={recordLayout}>
        <Swipeable {...commonProps} {...sideProps}>
          {content}
        </Swipeable>
      </View>
      <View style={styles.rowReadout}>
        <Text testID={`two-sided-presses-${id}`} style={readoutStyle}>
          Left {counters.left}; right {counters.right}; more {counters.more}; alternate{' '}
          {counters.legacy}
        </Text>
        <Text testID={`two-sided-events-${id}`} style={readoutStyle}>
          Start {counters.starts}; end {counters.ends}; left {counters.leftEnds}; right{' '}
          {counters.rightEnds}
        </Text>
        <Text testID={`two-sided-last-end-${id}`} style={readoutStyle}>
          {counters.last}
        </Text>
        <Text testID={`two-sided-layout-${id}`} style={readoutStyle}>
          Row width {layoutWidth}; key {recyclingKey(id)}
        </Text>
      </View>
    </View>
  )
}

export function TwoSidedScreen() {
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('commands')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [items, setItems] = useState(INITIAL_ITEMS)
  const [counters, setCounters] = useState<Record<number, Counters>>({})
  const [useFlatList, setUseFlatList] = useState(false)
  const [attached, setAttached] = useState(true)
  const [requestedDirection, setRequestedDirection] = useState<'LTR' | 'RTL' | null>(null)
  const [options, setOptions] = useState({
    language: 'en' as Language,
    rightOnly: false,
    leftEnabled: true,
    rightEnabled: true,
    leftWidth: 80,
    rightWidth: 120,
    gestureEnabled: true,
    autoClose: false,
    alternateContent: false,
    rounded: false,
    multiple: false,
    light: false,
    appearance: 'default' as 'default' | 'ios26',
    haptics: 'auto' as 'auto' | 'on' | 'off'
  })
  const rowRefs = useRef(new Map<number, SwipeableMethods>())
  const controlsRef = useRef<ScrollView>(null)
  const first = items[0] ?? { slot: 0, id: 0 }
  const reboundId = items.find((item) => item.slot === 0)?.id
  const containerStyle = useMemo(
    () => [styles.screen, { paddingBottom: insets.bottom }],
    [insets.bottom]
  )
  const selectTab = (next: Tab) => {
    setTab(next)
    controlsRef.current?.scrollTo({ y: 0, animated: false })
  }
  const showCommands = () => selectTab('commands')
  const showOptions = () => selectTab('options')
  const showRecycling = () => selectTab('recycling')
  const showLocalization = () => selectTab('localization')
  const requestDirection = (rtl: boolean) => {
    // Persist native preferences only. Changing labels is a separate live operation.
    // A full app termination/relaunch is required to apply the global direction.
    I18nManager.allowRTL(rtl)
    I18nManager.forceRTL(rtl)
    setRequestedDirection(rtl ? 'RTL' : 'LTR')
  }
  const requestLTR = () => requestDirection(false)
  const requestRTL = () => requestDirection(true)
  const toggleLanguage = () =>
    setOptions((value) => ({
      ...value,
      language: value.language === 'en' ? 'ar' : 'en',
      leftWidth: value.language === 'en' ? 112 : 80,
      rightWidth: value.language === 'en' ? 160 : 120
    }))
  const toggleRightOnly = () => setOptions((value) => ({ ...value, rightOnly: !value.rightOnly }))
  const toggleControls = () => setControlsVisible((value) => !value)
  const openLeft = () => rowRefs.current.get(first.slot)?.open('left')
  const openRight = () => rowRefs.current.get(first.slot)?.open('right')
  const staticLeft = () => Swipeable.open(recyclingKey(first.id), 'left')
  const staticRight = () => Swipeable.open(recyclingKey(first.id), 'right')
  const openPreferred = () => rowRefs.current.get(first.slot)?.open()
  const close = () => rowRefs.current.get(first.slot)?.close()
  const instantClose = () => rowRefs.current.get(first.slot)?.close(false)
  const closeAll = () => Swipeable.closeAll()
  const toggleLeft = () => setOptions((value) => ({ ...value, leftEnabled: !value.leftEnabled }))
  const toggleRight = () => setOptions((value) => ({ ...value, rightEnabled: !value.rightEnabled }))
  const toggleGesture = () =>
    setOptions((value) => ({ ...value, gestureEnabled: !value.gestureEnabled }))
  const toggleAutoClose = () => setOptions((value) => ({ ...value, autoClose: !value.autoClose }))
  const toggleAlternateContent = () =>
    setOptions((value) => ({ ...value, alternateContent: !value.alternateContent }))
  const resizeLeft = () =>
    setOptions((value) => ({ ...value, leftWidth: value.leftWidth === 80 ? 112 : 80 }))
  const resizeRight = () =>
    setOptions((value) => ({ ...value, rightWidth: value.rightWidth === 120 ? 160 : 120 }))
  const toggleAppearance = () =>
    setOptions((value) => ({
      ...value,
      appearance: value.appearance === 'default' ? 'ios26' : 'default'
    }))
  const toggleHaptics = () =>
    setOptions((value) => {
      const next = { auto: 'on', on: 'off', off: 'auto' } as const
      return { ...value, haptics: next[value.haptics] }
    })
  const toggleRounded = () => setOptions((value) => ({ ...value, rounded: !value.rounded }))
  const toggleMultiple = () => setOptions((value) => ({ ...value, multiple: !value.multiple }))
  const toggleLight = () => setOptions((value) => ({ ...value, light: !value.light }))
  const toggleList = () => setUseFlatList((value) => !value)
  const toggleAttached = () => setAttached((value) => !value)
  const rebind = () =>
    setItems((value) =>
      value.map((item) => (item.slot === 0 ? { ...item, id: item.id === 0 ? 100 : 0 } : item))
    )
  const reorder = () =>
    setItems((value) => {
      const [a, b, ...rest] = value
      return a && b ? [b, a, ...rest] : value
    })
  const onAction = useCallback((id: number, action: Action) => {
    setCounters((value) => {
      const current = value[id] ?? EMPTY_COUNTERS
      return { ...value, [id]: { ...current, [action]: current[action] + 1 } }
    })
  }, [])
  const onEvent = useCallback(
    (id: number, field: 'starts' | 'ends' | 'leftEnds' | 'rightEnds', last?: string) => {
      setCounters((value) => {
        const current = value[id] ?? EMPTY_COUNTERS
        return {
          ...value,
          [id]: { ...current, [field]: current[field] + 1, last: last ?? current.last }
        }
      })
    },
    []
  )
  const renderItem = useCallback(
    ({ item }: { item: Item }) => (
      <DemoRow
        item={item}
        counters={counters[item.id] ?? EMPTY_COUNTERS}
        options={options}
        rowRefs={rowRefs}
        onAction={onAction}
        onEvent={onEvent}
      />
    ),
    [counters, options, onAction, onEvent]
  )
  const listExtraData = useMemo(() => ({ counters, options }), [counters, options])
  const autoHapticsEnabled = Platform.OS === 'ios' && options.appearance === 'ios26'
  const hapticsLabel =
    options.haptics === 'auto' ? `Auto (${autoHapticsEnabled ? 'on' : 'off'})` : options.haptics

  return (
    <View testID='two-sided-demo' style={containerStyle}>
      <View style={styles.controlsHeader}>
        <Control
          name='toggle-controls'
          label={controlsVisible ? 'Hide controls' : 'Show controls'}
          onPress={toggleControls}
          variant='toggle'
        />
      </View>
      {controlsVisible && (
        <View style={styles.controlsPane}>
          <ScrollView
            horizontal
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabsContent}
          >
            <Control
              name='tab-commands'
              label='Commands'
              variant='tab'
              selected={tab === 'commands'}
              onPress={showCommands}
            />
            <Control
              name='tab-options'
              label='Options'
              variant='tab'
              selected={tab === 'options'}
              onPress={showOptions}
            />
            <Control
              name='tab-recycling'
              label='Recycling'
              variant='tab'
              selected={tab === 'recycling'}
              onPress={showRecycling}
            />
            <Control
              name='tab-localization'
              label='Language/RTL'
              variant='tab'
              selected={tab === 'localization'}
              onPress={showLocalization}
            />
          </ScrollView>
          <ScrollView
            ref={controlsRef}
            testID='two-sided-controls'
            style={styles.controlsScroll}
            contentContainerStyle={styles.controlsContent}
          >
            {tab === 'commands' && (
              <>
                <Text style={styles.readout}>
                  Commands target the first row: {first.id}. No drag needed.
                </Text>
                <View style={styles.controlRow}>
                  <Control name='open-left' label='Ref open left' onPress={openLeft} />
                  <Control name='open-right' label='Ref open right' onPress={openRight} />
                  <Control name='static-left' label='Static open left' onPress={staticLeft} />
                  <Control name='static-right' label='Static open right' onPress={staticRight} />
                  <Control name='open-preferred' label='Ref open()' onPress={openPreferred} />
                  <Control name='close' label='Close' onPress={close} />
                  <Control name='instant-close' label='Instant close' onPress={instantClose} />
                  <Control name='close-all' label='Close all' onPress={closeAll} />
                </View>
              </>
            )}
            {tab === 'options' && (
              <View style={styles.controlRow}>
                <Control
                  name='appearance'
                  label={`Appearance: ${options.appearance === 'ios26' ? 'iOS 26' : 'Default'}`}
                  onPress={toggleAppearance}
                />
                <Control
                  name='haptics'
                  label={`Haptics: ${hapticsLabel}`}
                  onPress={toggleHaptics}
                />
                <Text style={styles.controlHint}>
                  {Platform.OS === 'ios'
                    ? 'Auto follows appearance: iOS 26 on, Default off.'
                    : 'Appearance and haptic presets apply to iOS only.'}
                </Text>
                <Control
                  name='left-enabled'
                  label={`Left: ${options.leftEnabled ? 'enabled' : 'disabled'}`}
                  onPress={toggleLeft}
                />
                <Control
                  name='right-enabled'
                  label={`Right: ${options.rightEnabled ? 'enabled' : 'disabled'}`}
                  onPress={toggleRight}
                />
                <Control
                  name='gesture'
                  label={`Gesture: ${options.gestureEnabled ? 'on' : 'off'}`}
                  onPress={toggleGesture}
                />
                <Control
                  name='auto-close'
                  label={`Auto close: ${options.autoClose ? 'on' : 'off'}`}
                  onPress={toggleAutoClose}
                />
                <Control
                  name='mixed'
                  label={`Alternate explicit content: ${options.alternateContent ? 'on' : 'off'}`}
                  onPress={toggleAlternateContent}
                />
                <Control
                  name='left-width'
                  label={`Left width: ${options.leftWidth}`}
                  onPress={resizeLeft}
                />
                <Control
                  name='right-width'
                  label={`Right width: ${options.rightWidth}`}
                  onPress={resizeRight}
                />
                <Control
                  name='rounded'
                  label={`Rounded / inset: ${options.rounded ? 'on' : 'off'}`}
                  onPress={toggleRounded}
                />
                <Control
                  name='multiple'
                  label={`Multiple actions: ${options.multiple ? 'on' : 'off'}`}
                  onPress={toggleMultiple}
                />
                <Control
                  name='light'
                  label={`Row surroundings: ${options.light ? 'light' : 'dark'}`}
                  onPress={toggleLight}
                />
                <Text style={styles.controlHint}>
                  {Platform.OS === 'ios'
                    ? 'Native iOS feedback. Reduce Motion suppresses the optional pop; haptics keep your preference.'
                    : 'Android keeps its normal native motion. The iOS preset and native haptics have no added effect.'}{' '}
                  Rounded buttons are caller styling. Widths include all padding and gaps.
                </Text>
              </View>
            )}
            {tab === 'recycling' && (
              <View style={styles.controlRow}>
                <Control
                  name='list-type'
                  label={`List: ${useFlatList ? 'FlatList' : 'FlashList'}`}
                  onPress={toggleList}
                />
                <Control name='rebind' label={`Rebind slot 0: ${reboundId}`} onPress={rebind} />
                <Control
                  name='reorder'
                  label={`Swap first two: ${first.id} first`}
                  onPress={reorder}
                />
                <Control
                  name='attach'
                  label={attached ? 'Detach rows' : 'Attach rows'}
                  onPress={toggleAttached}
                />
                <Text style={styles.readout}>
                  Rebind keeps the cell mounted. Reorder keeps item keys. Detach and attach preserve
                  cached sides; then try Close all.
                </Text>
              </View>
            )}
            {tab === 'localization' && (
              <View>
                <Text testID='two-sided-direction-active' style={styles.readout}>
                  {I18nManager.isRTL ? 'RTL' : 'LTR'}
                </Text>
                <Text testID='two-sided-direction-request' style={styles.readout}>
                  {requestedDirection
                    ? `Restart required: ${requestedDirection}`
                    : 'No direction change requested'}
                </Text>
                <View style={styles.directionProbe} collapsable={false}>
                  <View
                    testID='two-sided-direction-first'
                    style={styles.directionMarker}
                    collapsable={false}
                  />
                  <View
                    testID='two-sided-direction-second'
                    style={styles.directionMarker}
                    collapsable={false}
                  />
                </View>
                <View style={styles.controlRow}>
                  <Control
                    name='direction-ltr'
                    label='Request LTR (restart)'
                    onPress={requestLTR}
                  />
                  <Control
                    name='direction-rtl'
                    label='Request RTL (restart)'
                    onPress={requestRTL}
                  />
                  <Control
                    name='language'
                    label={`Labels: ${options.language}`}
                    onPress={toggleLanguage}
                  />
                  <Control
                    name='legacy-only'
                    label={`Right only: ${options.rightOnly ? 'on' : 'off'}`}
                    onPress={toggleRightOnly}
                  />
                </View>
                <Text style={styles.readout}>
                  Language changes labels and explicit widths without remounting rows. Left and
                  right stay physical edges.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}
      <View style={styles.listPane}>
        {attached &&
          (useFlatList ? (
            <FlatList
              testID='two-sided-list'
              data={items}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              extraData={listExtraData}
              contentContainerStyle={styles.listContent}
              // Mount a few screens of rows, as an app list would. Mounting all
              // rows makes every XCUITest query snapshot a much larger tree.
              initialNumToRender={8}
              windowSize={3}
            />
          ) : (
            <FlashList
              testID='two-sided-list'
              maintainVisibleContentPosition={FLASH_LIST_SCROLL_POSITION}
              data={items}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              extraData={listExtraData}
              contentContainerStyle={styles.listContent}
            />
          ))}
        {!attached && <Text style={styles.readout}>Rows detached. Attach them in Recycling.</Text>}
      </View>
    </View>
  )
}

const controlBase = {
  minHeight: 44,
  minWidth: 96,
  flexBasis: '46%' as const,
  flexGrow: 1,
  flexShrink: 1,
  justifyContent: 'center' as const,
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: 8
}
const contentBase = { minHeight: 100, padding: 16, justifyContent: 'center' as const }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundDark },
  directionProbe: { flexDirection: 'row', height: 8 },
  directionMarker: { width: 8, height: 8, backgroundColor: colors.primary },
  controlsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    gap: 8
  },
  controlsPane: { maxHeight: '34%', backgroundColor: colors.backgroundSurface },
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabsContent: { paddingHorizontal: 8, paddingVertical: 4, gap: 6 },
  tabControl: { minWidth: 0, flexBasis: 'auto', flexGrow: 0 },
  toggleControl: { flexBasis: 'auto', flexGrow: 0, backgroundColor: 'transparent' },
  tabText: { fontSize: 12 },
  controlHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  controlsContent: { padding: 8, gap: 6 },
  controlsScroll: { flexShrink: 1 },
  control: { ...controlBase, backgroundColor: colors.configButtonBg },
  selectedControl: { ...controlBase, backgroundColor: colors.primary },
  controlText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  listPane: { flex: 1, minHeight: 100 },
  listContent: { padding: 12 },
  card: { marginBottom: 16, backgroundColor: colors.backgroundSurface },
  lightCard: { marginBottom: 16, backgroundColor: colors.textPrimary },
  content: { ...contentBase, backgroundColor: colors.backgroundInput },
  lightContent: { ...contentBase, backgroundColor: colors.textPrimary },
  title: { color: colors.textPrimary, fontSize: 18, textAlign: 'center' },
  lightTitle: { color: colors.backgroundDark, fontSize: 18, textAlign: 'center' },
  anchor: { width: 1, height: 1, alignSelf: 'center' },
  rowReadout: { padding: 8, gap: 2 },
  readout: { color: colors.textSecondary, fontSize: 14, flexShrink: 1 },
  lightReadout: { color: colors.backgroundInput, fontSize: 14, flexShrink: 1 },
  rail: { flexDirection: 'row' },
  insetRail: { flexDirection: 'row', padding: 8, gap: 8 },
  action: { flex: 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  roundedAction: { borderRadius: 16 },
  leftAction: { backgroundColor: colors.primary },
  rightAction: { backgroundColor: colors.danger },
  actionText: { color: colors.textPrimary, fontSize: 16, textAlign: 'center' }
})
