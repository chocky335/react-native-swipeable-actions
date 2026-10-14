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
export const mixed = (
  <Swipeable actions={action} actionsWidth={120} leftActions={action} leftActionsWidth={80}>
    {row}
  </Swipeable>
)
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
