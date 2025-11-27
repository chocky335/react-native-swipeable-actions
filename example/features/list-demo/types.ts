import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { SwipeableMethods } from 'react-native-swipeable-actions'

export type Implementation = 'swipeable' | 'rngh'

export interface ItemData {
  id: string
  title: string
  subtitle: string
}
export interface RowContentProps {
  item: ItemData
  onPress: () => void
}

export interface SwipeableRowItemProps {
  item: ItemData
  isReversed: boolean
  onMute: (id: string) => void
  onLeave: (id: string) => void
  onRowPress: (id: string) => void
  swipeableRef: React.RefObject<SwipeableMethods | null>
  onSwipeStart?: () => void
  onSwipeEnd?: (state: 'open' | 'closed') => void
  friction?: number
  threshold?: number
  dragOffsetFromEdge?: number
}

export type ReanimatedSwipeableRef = {
  close: () => void
  reset: () => void
}

export interface RNGHRowItemProps {
  item: ItemData
  isReversed: boolean
  onMute: (id: string) => void
  onLeave: (id: string) => void
  onRowPress: (id: string) => void
  swipeableRef: React.RefObject<ReanimatedSwipeableRef | null>
  onSwipeStart?: () => void
  onSwipeEnd?: (state: 'open' | 'closed') => void
}

export type RowRef = React.RefObject<SwipeableMethods | ReanimatedSwipeableRef | null>
