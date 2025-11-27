import { StyleSheet } from 'react-native'
import { colors } from './theme'

/**
 * Shared button and pill styles for controls.
 * These styles are used across ConfigPanel and ListConfigSection.
 */

export const buttonStyles = StyleSheet.create({
  // Large pill button (e.g., implementation selector)
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.pillInactive
  },

  // Small pill toggle (e.g., ON/OFF toggles)
  smallPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.pillInactive
  },

  // Active state for pills
  pillActive: {
    backgroundColor: colors.pillActive
  },

  // Pill text styling
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary
  },

  // Active pill text
  pillTextActive: {
    color: colors.textPrimary
  },

  // Primary action button
  closeButton: {
    backgroundColor: colors.buttonPrimary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center'
  },

  // Benchmark variant
  benchmarkButton: {
    backgroundColor: colors.buttonBenchmark
  },

  // Disabled state
  buttonDisabled: {
    opacity: 0.5
  },

  // Button text styling
  closeButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  }
})

/**
 * Shared layout styles for control rows.
 */
export const layoutStyles = StyleSheet.create({
  // Horizontal row for control elements
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },

  // Control label text
  controlLabel: {
    fontSize: 16,
    color: colors.textPrimary
  },

  // Horizontal picker/toggle container
  pickerRow: {
    flexDirection: 'row',
    gap: 8
  }
})
