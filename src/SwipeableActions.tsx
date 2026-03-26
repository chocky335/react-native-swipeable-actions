import React, { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

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
 * Handles entrance animation when children mount.
 */
export function SwipeableActions({ children, actionsPosition, testID }: SwipeableActionsProps) {
  return (
    <View
      style={actionsPosition === 'left' ? styles.actionsLeading : styles.actionsTrailing}
      pointerEvents={children ? 'auto' : 'none'}
      testID={testID}
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
