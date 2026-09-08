import { type ComponentProps, type ComponentRef, createElement, forwardRef } from 'react'
import Swipeable from '../Swipeable'
import type { SwipeableMethods, SwipeableStatic, SwipeableProps } from '../Swipeable.types'

interface LegacyConsumerProps extends SwipeableProps {
  rowID: string
  debugLabel?: string
}

const LegacyConsumer = forwardRef<SwipeableMethods, LegacyConsumerProps>(function LegacyConsumer(
  { debugLabel: _debugLabel, rowID: _rowID, ...props },
  ref
) {
  return <Swipeable {...props} ref={ref} />
})

type LegacyConsumerPropsInferred = ComponentProps<typeof LegacyConsumer>
type LegacyConsumerRef = ComponentRef<typeof LegacyConsumer>
type LegacySwipeablePropsInferred = ComponentProps<typeof Swipeable>
type LegacySwipeableRef = ComponentRef<typeof Swipeable>

const legacyProps: SwipeableProps = {
  children: createElement('View', { testID: 'type-test-content' }),
  actions: createElement('View', { testID: 'type-test-actions' }),
  actionsWidth: 84
}

const legacyConsumerProps: LegacyConsumerPropsInferred = {
  ...legacyProps,
  rowID: 'row-1',
  debugLabel: 'legacy'
}

const methods: SwipeableMethods = {
  close: () => undefined,
  open: () => undefined,
  cancel: () => undefined
}

const staticFacade: SwipeableStatic = {
  open: (_recyclingKey: string) => undefined,
  close: (_recyclingKey: string, _animated?: boolean) => undefined,
  cancel: (_recyclingKey: string) => undefined,
  closeAll: (_animated?: boolean) => undefined
}

const requiredActionsWidth: number = legacyProps.actionsWidth
const legacyActions = legacyProps.actions
const inferredRowProps: LegacySwipeablePropsInferred = {
  ...legacyProps
}
const inferredRequiredWidth: number = inferredRowProps.actionsWidth
const inferredRowRef: LegacySwipeableRef = methods
const inferredConsumerProps: LegacyConsumerPropsInferred = legacyConsumerProps
const inferredConsumerRef: LegacyConsumerRef = methods

export {
  LegacyConsumer,
  methods,
  staticFacade,
  requiredActionsWidth,
  inferredRequiredWidth,
  legacyActions,
  inferredRowProps,
  inferredRowRef,
  inferredConsumerProps,
  inferredConsumerRef
}
