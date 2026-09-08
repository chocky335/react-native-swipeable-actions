import { FlashList } from '@shopify/flash-list'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  FlatList,
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

type Tab = 'commands' | 'options' | 'recycling'
type Action = SwipeSide | 'more' | 'legacy'
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
  selected = false
}: {
  name: string
  label: string
  onPress: () => void
  selected?: boolean
}) {
  const style = selected ? styles.selectedControl : styles.control
  const accessibilityState = useMemo(() => ({ selected }), [selected])
  return (
    <Pressable
      testID={`two-sided-${name}`}
      accessibilityRole='button'
      accessibilityState={accessibilityState}
      style={style}
      onPress={onPress}
    >
      <Text testID={`two-sided-${name}-label`} style={styles.controlText}>
        {label}
      </Text>
    </Pressable>
  )
}

function ActionButton({
  id,
  action,
  rounded,
  onAction
}: {
  id: number
  action: Action
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
  const labels = { left: 'Pin', right: 'Del', more: '...', legacy: 'Old' }
  return (
    <Pressable
      testID={`two-sided-action-${action}-${id}`}
      accessibilityRole='button'
      accessibilityLabel={`${action} action for row ${id}`}
      onPress={press}
      style={style}
    >
      <Text style={styles.actionText}>{labels[action]}</Text>
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
    leftEnabled: boolean
    rightEnabled: boolean
    leftWidth: number
    rightWidth: number
    gestureEnabled: boolean
    autoClose: boolean
    mixed: boolean
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
  const legacy = options.mixed
    ? {
        actions: (
          <View style={styles.legacyRail}>
            <ActionButton id={id} action='legacy' rounded={false} onAction={onAction} />
          </View>
        ),
        actionsWidth: 96,
        actionsPosition: 'right' as const
      }
    : {}
  const feedback = options.haptics === 'auto' ? {} : { hapticFeedback: options.haptics === 'on' }
  const sideProps = {
    leftActions: options.leftEnabled ? (
      <View style={leftRailStyle}>
        <ActionButton id={id} action='left' rounded={options.rounded} onAction={onAction} />
      </View>
    ) : null,
    leftActionsWidth: options.leftWidth,
    rightActions: options.rightEnabled ? (
      <View style={rightRailStyle}>
        <ActionButton id={id} action='right' rounded={options.rounded} onAction={onAction} />
        {options.multiple && (
          <ActionButton id={id} action='more' rounded={options.rounded} onAction={onAction} />
        )}
      </View>
    ) : (
      false
    ),
    rightActionsWidth: options.rightWidth
  } satisfies Pick<
    TwoSidedSwipeableProps,
    'leftActions' | 'leftActionsWidth' | 'rightActions' | 'rightActionsWidth'
  >

  return (
    <View style={cardStyle}>
      <View testID={`two-sided-frame-${id}`} collapsable={false} onLayout={recordLayout}>
        <Swipeable
          {...legacy}
          {...sideProps}
          {...feedback}
          ref={attachRef}
          testID={`two-sided-row-${id}`}
          recyclingKey={recyclingKey(id)}
          gestureEnabled={options.gestureEnabled}
          autoClose={options.autoClose}
          autoCloseTimeout={250}
          appearance={options.appearance}
          onSwipeStart={recordStart}
          onSwipeEnd={recordEnd}
          onLeftSwipeEnd={recordLeftEnd}
          onRightSwipeEnd={recordRightEnd}
        >
          <View style={contentStyle} collapsable={false}>
            <Text style={titleStyle}>Row {id}</Text>
            <Text style={titleStyle}>
              Left {options.leftWidth} / Right {options.rightWidth}
            </Text>
            {/* A centered, unclipped marker exposes actual native translation to E2E. */}
            <View testID={`two-sided-anchor-${id}`} collapsable={false} style={styles.anchor} />
          </View>
        </Swipeable>
      </View>
      <View style={styles.rowReadout}>
        <Text testID={`two-sided-presses-${id}`} style={readoutStyle}>
          Left {counters.left}; right {counters.right}; more {counters.more}; legacy{' '}
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
  const [options, setOptions] = useState({
    leftEnabled: true,
    rightEnabled: true,
    leftWidth: 80,
    rightWidth: 120,
    gestureEnabled: true,
    autoClose: false,
    mixed: false,
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
  const toggleMixed = () => setOptions((value) => ({ ...value, mixed: !value.mixed }))
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

  return (
    <View testID='two-sided-demo' style={containerStyle}>
      <View>
        <Control
          name='toggle-controls'
          label={controlsVisible ? 'Hide controls' : 'Show controls'}
          onPress={toggleControls}
        />
      </View>
      {controlsVisible && (
        <View style={styles.controlsPane}>
          <View style={styles.controlRow}>
            <Control
              name='tab-commands'
              label='Commands'
              selected={tab === 'commands'}
              onPress={showCommands}
            />
            <Control
              name='tab-options'
              label='Options'
              selected={tab === 'options'}
              onPress={showOptions}
            />
            <Control
              name='tab-recycling'
              label='Recycling'
              selected={tab === 'recycling'}
              onPress={showRecycling}
            />
          </View>
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
                  label={`Legacy fallback: ${options.mixed ? 'on' : 'off'}`}
                  onPress={toggleMixed}
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
                  name='appearance'
                  label={`Appearance: ${options.appearance}`}
                  onPress={toggleAppearance}
                />
                <Control
                  name='haptics'
                  label={`Haptics: ${options.haptics}`}
                  onPress={toggleHaptics}
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
                <Text style={styles.readout}>
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
  flexGrow: 1,
  flexShrink: 1,
  justifyContent: 'center' as const,
  padding: 10,
  borderRadius: 8
}
const contentBase = { minHeight: 100, padding: 16, justifyContent: 'center' as const }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundDark },
  controlsPane: { maxHeight: '42%', backgroundColor: colors.backgroundSurface },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  controlsContent: { padding: 12, gap: 8 },
  controlsScroll: { flexShrink: 1 },
  control: { ...controlBase, backgroundColor: colors.configButtonBg },
  selectedControl: { ...controlBase, backgroundColor: colors.primary },
  controlText: { color: colors.textPrimary, fontSize: 16, textAlign: 'center' },
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
  legacyRail: { width: 96, height: '100%', flexDirection: 'row' },
  action: { flex: 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  roundedAction: { borderRadius: 16 },
  leftAction: { backgroundColor: colors.primary },
  rightAction: { backgroundColor: colors.danger },
  actionText: { color: colors.textPrimary, fontSize: 16, textAlign: 'center' }
})
