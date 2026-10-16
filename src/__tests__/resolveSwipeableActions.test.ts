import { resolveSwipeableActions } from '../resolveSwipeableActions'

describe('explicit-side action configuration', () => {
  it.each(['left', 'right'] as const)('supports the original single-%s-side scenario', (side) => {
    const result = resolveSwipeableActions({
      [side + 'Actions']: 'action',
      [side + 'ActionsWidth']: 80
    })
    expect(result[side]).toEqual({ node: 'action', width: 80 })
    expect(result[side === 'left' ? 'right' : 'left']).toEqual({ node: null, width: 0 })
    expect(result.warnings).toEqual([])
  })

  it('keeps independently configured edges and widths', () => {
    const result = resolveSwipeableActions({
      leftActions: 'pin',
      leftActionsWidth: 60,
      rightActions: 'delete',
      rightActionsWidth: 120
    })
    expect(result.left).toEqual({ node: 'pin', width: 60 })
    expect(result.right).toEqual({ node: 'delete', width: 120 })
  })

  it('replaces action content without inheriting another edge', () => {
    const before = { rightActions: 'delete', rightActionsWidth: 120 }
    expect(resolveSwipeableActions({ ...before, rightActions: 'archive' }).right).toEqual({
      node: 'archive',
      width: 120
    })
  })

  it.each([
    null,
    false,
    undefined
  ])('disables an edge with %s content without fallback', (rightActions) => {
    const result = resolveSwipeableActions({ rightActions })
    expect(result.right).toEqual({ node: null, width: 0 })
    expect(result.left).toEqual({ node: null, width: 0 })
  })

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])('disables an invalid width %s', (rightActionsWidth) => {
    const result = resolveSwipeableActions({ rightActions: 'delete', rightActionsWidth })
    expect(result.right).toEqual({ node: null, width: 0 })
    expect(result.warnings).toHaveLength(1)
  })

  it('requires the width of the configured side', () => {
    const result = resolveSwipeableActions({
      leftActions: 'pin',
      leftActionsWidth: 80,
      rightActions: 'delete'
    })
    expect(result.right.width).toBe(0)
    expect(result.left.width).toBe(80)
    expect(result.warnings).toHaveLength(1)
  })

  it('does not enable a side with width alone', () => {
    const result = resolveSwipeableActions({ rightActionsWidth: 120 })
    expect(result.right).toEqual({ node: null, width: 0 })
    expect(result.warnings).toHaveLength(1)
  })

  it('keeps zero-valued React content', () => {
    expect(resolveSwipeableActions({ leftActions: 0, leftActionsWidth: 80 }).left).toEqual({
      node: 0,
      width: 80
    })
  })

  it('never interprets removed legacy props as a fallback', () => {
    const oldJavaScriptInput = {
      actions: 'old',
      actionsWidth: 80,
      actionsPosition: 'left',
      rightActions: undefined
    }
    const result = resolveSwipeableActions(oldJavaScriptInput)
    expect(result.left).toEqual({ node: null, width: 0 })
    expect(result.right).toEqual({ node: null, width: 0 })
  })

  it('disables a previously configured side even when its old width remains', () => {
    expect(resolveSwipeableActions({ rightActions: null, rightActionsWidth: 120 }).right).toEqual({
      node: null,
      width: 0
    })
  })
})
