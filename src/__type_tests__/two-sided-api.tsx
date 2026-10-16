import { createRef } from 'react'
import { Text } from 'react-native'
import {
  Swipeable,
  type SwipeableComponentProps,
  type SwipeableMethods,
  type TwoSidedSwipeableProps
} from '../index'

const action = <Text>Action</Text>
const row = <Text>Row</Text>
const ref = createRef<SwipeableMethods>()
export const leftOnly = (
  <Swipeable ref={ref} leftActions={action} leftActionsWidth={80}>
    {row}
  </Swipeable>
)
export const rightOnly = (
  <Swipeable rightActions={action} rightActionsWidth={120}>
    {row}
  </Swipeable>
)
export const both = (
  <Swipeable
    leftActions={action}
    leftActionsWidth={80}
    rightActions={action}
    rightActionsWidth={120}
    onLeftSwipeEnd={(state) => state}
    appearance='ios26'
  >
    {row}
  </Swipeable>
)
export const mixed: SwipeableComponentProps = {
  children: row,
  leftActions: action,
  leftActionsWidth: 80,
  // @ts-expect-error Removed legacy props cannot be mixed with the explicit-side API.
  actions: action,
  actionsWidth: 120
}
export const removedLegacy: SwipeableComponentProps = {
  children: row,
  // @ts-expect-error The original action pair is no longer a supported configuration.
  actions: action,
  actionsWidth: 120
}
export const removedPosition: SwipeableComponentProps = {
  children: row,
  rightActions: action,
  rightActionsWidth: 120,
  // @ts-expect-error Configure physical edges by their explicit pair, not actionsPosition.
  actionsPosition: 'left'
}
export const disabled = (
  <Swipeable leftActions={null} rightActions={false}>
    {row}
  </Swipeable>
)
export const input: TwoSidedSwipeableProps = {
  children: row,
  leftActions: action,
  leftActionsWidth: 80
}
export const allInputs: SwipeableComponentProps = input

ref.current?.open()
ref.current?.open('left')
ref.current?.cancel()
Swipeable.open('row')
Swipeable.open('row', 'right')
Swipeable.cancel('row')

// @ts-expect-error Explicit action content needs its matching width.
export const missingWidth = <Swipeable leftActions={action}>{row}</Swipeable>
// @ts-expect-error A width cannot enable an otherwise unspecified edge.
export const widthWithoutContent = <Swipeable rightActionsWidth={120}>{row}</Swipeable>
// @ts-expect-error Retain rejection of completely missing action configuration.
export const missingConfiguration = <Swipeable>{row}</Swipeable>
// @ts-expect-error Side names refer to physical left/right edges.
ref.current?.open('start')
