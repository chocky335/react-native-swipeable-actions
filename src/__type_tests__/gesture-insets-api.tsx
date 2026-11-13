import { Text } from 'react-native'
import {
  type GestureInsets,
  Swipeable,
  type SwipeableProps,
  type SwipeableViewProps
} from '../index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type EveryEdgeIsAnOptionalNumber = Assert<
  Equal<GestureInsets, { top?: number; bottom?: number; left?: number; right?: number }>
>
export type RowAndRawViewShareTheType = Assert<
  Equal<SwipeableProps['gestureInsets'], SwipeableViewProps['gestureInsets']>
>

const action = <Text>Action</Text>
const row = <Text>Row</Text>
const BOTTOM_PAGER: GestureInsets = { bottom: 320 }

export const oneEdge = (
  <Swipeable leftActions={action} leftActionsWidth={80} gestureInsets={BOTTOM_PAGER}>
    {row}
  </Swipeable>
)
export const withoutInsets = (
  <Swipeable leftActions={action} leftActionsWidth={80}>
    {row}
  </Swipeable>
)
// @ts-expect-error An inset is a number of layout units, not a string.
export const stringInset: GestureInsets = { bottom: '320' }
// @ts-expect-error Insets use the physical edges of the row.
export const logicalEdge: GestureInsets = { start: 16 }
