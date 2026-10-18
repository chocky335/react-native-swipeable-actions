import { type ComponentProps, type ComponentRef, createElement, forwardRef } from 'react'
import Swipeable from '../Swipeable'
import type { SwipeableMethods, SwipeableStatic, SwipeableProps } from '../Swipeable.types'

type MigratedConsumerProps = SwipeableProps & {
  rowID: string
  debugLabel?: string
}

const MigratedConsumer = forwardRef<SwipeableMethods, MigratedConsumerProps>(
  function MigratedConsumer({ debugLabel: _debugLabel, rowID: _rowID, ...props }, ref) {
    return <Swipeable {...props} ref={ref} />
  }
)

type MigratedConsumerPropsInferred = ComponentProps<typeof MigratedConsumer>
type MigratedConsumerRef = ComponentRef<typeof MigratedConsumer>
type MigratedSwipeablePropsInferred = ComponentProps<typeof Swipeable>
type MigratedSwipeableRef = ComponentRef<typeof Swipeable>

const migratedProps: SwipeableProps = {
  children: createElement('View', { testID: 'type-test-content' }),
  rightActions: createElement('View', { testID: 'type-test-actions' }),
  rightActionsWidth: 84
}

const migratedConsumerProps: MigratedConsumerPropsInferred = {
  ...migratedProps,
  rowID: 'row-1',
  debugLabel: 'migrated'
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

const requiredActionsWidth: number = migratedProps.rightActionsWidth
const migratedActions = migratedProps.rightActions
const inferredRowProps: MigratedSwipeablePropsInferred = {
  ...migratedProps
}
const inferredRequiredWidth: number = inferredRowProps.rightActionsWidth
const inferredRowRef: MigratedSwipeableRef = methods
const inferredConsumerProps: MigratedConsumerPropsInferred = migratedConsumerProps
const inferredConsumerRef: MigratedConsumerRef = methods

export {
  MigratedConsumer,
  methods,
  staticFacade,
  requiredActionsWidth,
  inferredRequiredWidth,
  migratedActions,
  inferredRowProps,
  inferredRowRef,
  inferredConsumerProps,
  inferredConsumerRef
}
