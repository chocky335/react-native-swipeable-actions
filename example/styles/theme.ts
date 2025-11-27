/**
 * Theme color palette for the example app.
 * Centralizes all color values for consistency and easy maintenance.
 */

export const colors = {
  // Backgrounds
  backgroundDark: '#0D0F16',
  backgroundSurface: '#1A1D24',
  backgroundInput: '#1F2936',
  backgroundMuted: '#2C2C2C',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#B0B0B0',

  // Accent Colors
  primary: '#0A84FF',
  warning: '#FF9F0A',
  danger: '#FF453A',

  // Chat-specific
  borderDark: '#2C3E50',
  bubbleOutgoing: '#2B5278',
  timestampGray: '#6D7883',
  senderAlice: '#5C6BC0',
  senderYou: '#26A69A',

  // HUD/Debug colors
  hudSuccess: '#0f0',
  hudMuted: '#999999',
  overlay: 'rgba(0, 0, 0, 0.8)',

  // Text opacity variants
  textMuted50: 'rgba(255, 255, 255, 0.5)',
  textMuted70: 'rgba(255, 255, 255, 0.7)',

  // Primary variants
  primaryLight: 'rgba(10, 132, 255, 0.2)',

  // UI elements
  configButtonBg: '#2A2D34',

  // Semantic aliases
  buttonPrimary: '#0A84FF',
  buttonBenchmark: '#FF9F0A',
  pillInactive: '#2C2C2C',
  pillActive: '#0A84FF',
  border: '#2C2C2C'
} as const

export const avatarColors = [
  '#0A84FF', // Blue
  '#FF453A', // Red
  '#30D158', // Green
  '#FF9F0A', // Orange
  '#BF5AF2', // Purple
  '#64D2FF' // Cyan
] as const

export type ThemeColors = typeof colors
