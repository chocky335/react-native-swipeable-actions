import type { ReactNode } from 'react'
import type { SwipeSide } from './Swipeable.types'

interface ActionsInput {
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
  const warnings: string[] = []
  const resolve = (side: SwipeSide, node: ReactNode, width?: number): ResolvedActions => {
    if (node !== undefined) {
      if (!isContent(node)) return { node: null, width: 0 }
      if (isWidth(width)) return { node, width }
      warnings.push(side + 'Actions requires a finite, positive ' + side + 'ActionsWidth.')
      return { node: null, width: 0 }
    }
    if (width !== undefined) {
      warnings.push(side + 'ActionsWidth is ignored without explicit ' + side + 'Actions.')
    }
    return { node: null, width: 0 }
  }
  const left = resolve('left', input.leftActions, input.leftActionsWidth)
  const right = resolve('right', input.rightActions, input.rightActionsWidth)
  return { left, right, warnings }
}
