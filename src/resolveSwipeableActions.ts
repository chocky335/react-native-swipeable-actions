import type { ReactNode } from 'react'
import { SWIPE_DEFAULTS } from './constants'
import type { SwipeSide } from './Swipeable.types'

interface ActionsInput {
  actions?: ReactNode
  actionsWidth?: number
  actionsPosition?: SwipeSide
  leftActions?: ReactNode
  leftActionsWidth?: number
  rightActions?: ReactNode
  rightActionsWidth?: number
}

export interface ResolvedActions {
  node: ReactNode
  width: number
}

const isContent = (node: ReactNode) => node != null && typeof node !== 'boolean'
const isWidth = (width: number | undefined): width is number =>
  width !== undefined && Number.isFinite(width) && width > 0

export function resolveSwipeableActions(input: ActionsInput) {
  const position = input.actionsPosition ?? SWIPE_DEFAULTS.ACTIONS_POSITION
  const twoSided =
    input.leftActions !== undefined ||
    input.rightActions !== undefined ||
    input.leftActionsWidth !== undefined ||
    input.rightActionsWidth !== undefined
  const warnings: string[] = []

  const resolve = (side: SwipeSide, node: ReactNode, width?: number): ResolvedActions => {
    if (node !== undefined) {
      if (!isContent(node)) return { node: null, width: 0 }
      if (isWidth(width)) return { node, width }
      warnings.push(`${side}Actions requires a finite, positive ${side}ActionsWidth.`)
      return { node: null, width: 0 }
    }
    if (width !== undefined) {
      warnings.push(`${side}ActionsWidth is ignored without explicit ${side}Actions.`)
    }
    if (position !== side) return { node: null, width: 0 }
    if (!twoSided) return { node: input.actions, width: input.actionsWidth ?? 0 }
    if (!isContent(input.actions)) return { node: null, width: 0 }
    if (!isWidth(input.actionsWidth)) {
      warnings.push(
        'Legacy actions used in two-sided mode require a finite, positive actionsWidth.'
      )
      return { node: null, width: 0 }
    }
    return { node: input.actions, width: input.actionsWidth }
  }

  const left = resolve('left', input.leftActions, input.leftActionsWidth)
  const right = resolve('right', input.rightActions, input.rightActionsWidth)
  return { twoSided, left, right, warnings }
}
