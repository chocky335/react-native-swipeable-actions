import { ItemData } from './types'

export const ITEM_COUNT = 100
export const DELETE_DELAY_MS = 200
export const METRICS_UPDATE_INTERVAL_MS = 500

export function generateData(count: number): ItemData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    title: `Item ${index}`,
    subtitle: `This is the description for item ${index}`
  }))
}
