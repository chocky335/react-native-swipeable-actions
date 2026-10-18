import type { SwipeableProps, SwipeableViewProps, SwipeStartEvent } from '../index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type PublicStartHasNoArguments = Assert<
  Equal<Parameters<NonNullable<SwipeableProps['onSwipeStart']>>, []>
>
export type NativeStartCarriesInternalIdentity = Assert<
  Equal<Parameters<NonNullable<SwipeableViewProps['onSwipeStart']>>, [event: SwipeStartEvent]>
>

export const nativeStart: SwipeableViewProps['onSwipeStart'] = (event) => {
  const key: string | undefined = event.nativeEvent.recyclingKey
  return key
}
