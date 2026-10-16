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
}

/**
 * SwipeableActions - Internal layout component for swipeable actions
 *
 * Provides a stable physical-edge slot while action content mounts lazily.
 */
export function SwipeableActions({ children, actionsPosition, testID }: SwipeableActionsProps) {
  // Side names are physical edges; flex row start/end reverse in RTL.
  const leading = I18nManager.isRTL ? actionsPosition === 'right' : actionsPosition === 'left'
  return (
    <View
      style={leading ? styles.actionsLeading : styles.actionsTrailing}
      pointerEvents={children ? 'auto' : 'none'}
      testID={testID}
      collapsable={false}
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
