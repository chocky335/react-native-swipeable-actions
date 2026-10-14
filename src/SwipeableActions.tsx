import type { ReactNode } from 'react'
import { I18nManager, StyleSheet, View } from 'react-native'

/**
 * Props for SwipeableActions component
 */
export interface SwipeableActionsProps {
  /** Action components to render */
  children: ReactNode
  /** Position of actions: 'left' or 'right' */
  actionsPosition: 'left' | 'right'
  /** Test ID for e2e testing */
  testID?: string
  /** Stable physical-edge shell for the two-sided native child protocol. */
  slot?: boolean
}

/**
 * SwipeableActions - Internal layout component for swipeable actions
 *
 * Handles entrance animation when children mount.
 */
export function SwipeableActions({
  children,
  actionsPosition,
  testID,
  slot
}: SwipeableActionsProps) {
  // Both APIs name physical edges; flex row start/end reverse in RTL.
  const leading = I18nManager.isRTL ? actionsPosition === 'right' : actionsPosition === 'left'
  return (
    <View
      style={leading ? styles.actionsLeading : styles.actionsTrailing}
      pointerEvents={children ? 'auto' : 'none'}
      testID={testID}
      {...(slot ? { collapsable: false } : {})}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  actionsTrailing: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'flex-end'
  },
  actionsLeading: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'flex-start'
  }
})
