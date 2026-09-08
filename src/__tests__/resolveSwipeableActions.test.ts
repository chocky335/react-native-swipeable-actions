import { resolveSwipeableActions } from '../resolveSwipeableActions'

const legacy = { actions: 'legacy', actionsWidth: 80 }

describe('action configuration resolution', () => {
  it.each([
    'left',
    'right'
  ] as const)('preserves the legacy %s configuration', (actionsPosition) => {
    const result = resolveSwipeableActions({ ...legacy, actionsPosition })
    expect(result.twoSided).toBe(false)
    expect(result[actionsPosition]).toEqual({ node: 'legacy', width: 80 })
    expect(result.warnings).toEqual([])
  })

  it('defaults legacy actions to the right', () => {
    expect(resolveSwipeableActions(legacy).right).toEqual({ node: 'legacy', width: 80 })
  })

  it('combines an explicit opposite side with the legacy pair', () => {
    const result = resolveSwipeableActions({
      ...legacy,
      leftActions: 'replace',
      leftActionsWidth: 60
    })
    expect(result.twoSided).toBe(true)
    expect(result.left).toEqual({ node: 'replace', width: 60 })
    expect(result.right).toEqual({ node: 'legacy', width: 80 })
  })

  it('uses an explicit pair in preference to the same legacy edge', () => {
    const result = resolveSwipeableActions({
      ...legacy,
      rightActions: 'delete',
      rightActionsWidth: 120
    })
    expect(result.right).toEqual({ node: 'delete', width: 120 })
  })

  it.each([null, false])('explicit %s disables legacy fallback', (rightActions) => {
    expect(resolveSwipeableActions({ ...legacy, rightActions }).right).toEqual({
      node: null,
      width: 0
    })
  })

  it('undefined content retains legacy fallback', () => {
    const result = resolveSwipeableActions({ ...legacy, rightActions: undefined })
    expect(result.right).toEqual({ node: 'legacy', width: 80 })
  })

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])('disables an invalid explicit width %s', (width) => {
    const result = resolveSwipeableActions({
      ...legacy,
      rightActions: 'delete',
      rightActionsWidth: width
    })
    expect(result.right).toEqual({ node: null, width: 0 })
    expect(result.warnings).toHaveLength(1)
  })

  it('requires a width for explicit content instead of inheriting the legacy width', () => {
    const result = resolveSwipeableActions({ ...legacy, rightActions: 'delete' })
    expect(result.right.width).toBe(0)
    expect(result.warnings).toHaveLength(1)
  })

  it('ignores a width supplied without content instead of changing legacy width', () => {
    const result = resolveSwipeableActions({ ...legacy, rightActionsWidth: 120 })
    expect(result.right).toEqual({ node: 'legacy', width: 80 })
    expect(result.warnings).toHaveLength(1)
  })

  it('keeps zero-valued React content', () => {
    const result = resolveSwipeableActions({ leftActions: 0, leftActionsWidth: 80 })
    expect(result.left).toEqual({ node: 0, width: 80 })
  })

  it('does not add validation to legacy-only inputs', () => {
    const result = resolveSwipeableActions({ actions: 'legacy', actionsWidth: -1 })
    expect(result.twoSided).toBe(false)
    expect(result.right.width).toBe(-1)
    expect(result.warnings).toHaveLength(0)
  })
})
