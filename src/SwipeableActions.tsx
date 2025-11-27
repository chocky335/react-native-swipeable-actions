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
}

/**
 * SwipeableActions - Internal layout component for swipeable actions
 *
 * Handles entrance animation when children mount.
 */
export function SwipeableActions({ children, actionsPosition }: SwipeableActionsProps) {
  return (
    <View
      style={actionsPosition === 'left' ? styles.actionsLeading : styles.actionsTrailing}
      pointerEvents={children ? 'auto' : 'none'}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  actionsTrailing: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end'
  },
  actionsLeading: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-start'
  }
})
