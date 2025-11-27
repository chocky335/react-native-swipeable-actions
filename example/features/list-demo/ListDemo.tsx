import { useCallback, useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import { StyleSheet, View, Alert } from 'react-native'
import { FlashList, FlashListRef, useBenchmark } from '@shopify/flash-list'
import { SwipeableMethods } from 'react-native-swipeable-actions'
import { SwipeableRowItem } from './SwipeableRowItem'
import { RNGHRowItem } from './RNGHRowItem'
import { ItemData, Implementation, RowRef, ReanimatedSwipeableRef } from './types'
import { ITEM_COUNT, generateData } from './utils'
import { colors } from '../../styles'

export interface ListDemoRef {
  closeAllRows: () => void
  resetAllRows: () => void
  startBenchmark: () => void
}

interface ListDemoProps {
  implementation: Implementation
  isReversed: boolean
  friction: number
  threshold: number
  dragOffset: number
  onBenchmarkStateChange?: (running: boolean, result: string | null) => void
}

export const ListDemo = forwardRef<ListDemoRef, ListDemoProps>(function ListDemo(
  { implementation, isReversed, friction, threshold, dragOffset, onBenchmarkStateChange },
  ref
) {
  const [data, setData] = useState(() => generateData(ITEM_COUNT))

  const flashListRef = useRef<FlashListRef<ItemData>>(null)
  const rowRefs = useRef<Map<string, RowRef>>(new Map())

  const { startBenchmark, isBenchmarkRunning } = useBenchmark(
    flashListRef as React.RefObject<FlashListRef<ItemData>>,
    (result) => {
      if (result.js) {
        const averageFps = result.js.averageFPS.toFixed(1)
        const minFps = result.js.minFPS.toFixed(1)
        const maxFps = result.js.maxFPS.toFixed(1)
        const formattedResult = `Avg: ${averageFps} | Min: ${minFps} | Max: ${maxFps}`
        onBenchmarkStateChange?.(false, formattedResult)
        console.log(
          'BENCHMARK_RESULT:',
          JSON.stringify({
            implementation,
            ...result.js,
            timestamp: Date.now()
          })
        )
      }
    },
    {
      repeatCount: 3,
      speedMultiplier: 1.0,
      startManually: true
    }
  )

  useEffect(() => {
    onBenchmarkStateChange?.(isBenchmarkRunning, null)
  }, [isBenchmarkRunning, onBenchmarkStateChange])

  const closeAllRows = useCallback(() => {
    rowRefs.current.forEach((rowRef) => {
      rowRef.current?.close()
    })
  }, [])

  const resetAllRows = useCallback(() => {
    rowRefs.current.forEach((rowRef) => {
      rowRef.current?.close(false)
    })
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      closeAllRows,
      resetAllRows,
      startBenchmark
    }),
    [closeAllRows, resetAllRows, startBenchmark]
  )

  const getOrCreateRef = useCallback((itemId: string): RowRef => {
    if (!rowRefs.current.has(itemId)) {
      rowRefs.current.set(itemId, { current: null })
    }
    return rowRefs.current.get(itemId)!
  }, [])

  const handleMute = useCallback((itemId: string) => {
    Alert.alert('Muted', `Item ${itemId} was muted`)
  }, [])

  const handleLeave = useCallback((itemId: string) => {
    setData((previousData) => previousData.filter((item) => item.id !== itemId))
    rowRefs.current.delete(itemId)
    Alert.alert('Left', `Item ${itemId} was removed`)
  }, [])

  const handleRowPress = useCallback((itemId: string) => {
    Alert.alert('Row Pressed', `You tapped: ${itemId}`)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: ItemData }) => {
      if (implementation === 'swipeable') {
        return (
          <SwipeableRowItem
            item={item}
            isReversed={isReversed}
            onMute={handleMute}
            onLeave={handleLeave}
            onRowPress={handleRowPress}
            swipeableRef={getOrCreateRef(item.id) as React.RefObject<SwipeableMethods | null>}
            friction={friction}
            threshold={threshold}
            dragOffsetFromEdge={dragOffset}
          />
        )
      }

      return (
        <RNGHRowItem
          item={item}
          isReversed={isReversed}
          onMute={handleMute}
          onLeave={handleLeave}
          onRowPress={handleRowPress}
          swipeableRef={getOrCreateRef(item.id) as React.RefObject<ReanimatedSwipeableRef>}
        />
      )
    },
    [
      isReversed,
      handleMute,
      handleLeave,
      handleRowPress,
      getOrCreateRef,
      implementation,
      friction,
      threshold,
      dragOffset
    ]
  )

  const keyExtractor = useCallback(
    (item: ItemData) => `${implementation}-${item.id}`,
    [implementation]
  )

  const renderSeparator = useCallback(() => <View style={styles.separator} />, [])

  const getItemType = useCallback(() => 'list-row', [])

  return (
    <FlashList
      ref={flashListRef}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      extraData={implementation}
      ItemSeparatorComponent={renderSeparator}
      getItemType={getItemType}
    />
  )
})

const styles = StyleSheet.create({
  separator: {
    height: 1,
    backgroundColor: colors.border
  }
})
