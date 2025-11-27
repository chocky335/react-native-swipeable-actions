import { createElement, forwardRef, ReactNode } from './react'

interface ViewProps {
  children?: ReactNode
  style?: unknown
  testID?: string
  pointerEvents?: string
}

interface TextProps {
  children?: ReactNode
  style?: unknown
  testID?: string
}

interface TouchableOpacityProps {
  children?: ReactNode
  style?: unknown
  onPress?: () => void
  activeOpacity?: number
  testID?: string
}

export const View = forwardRef<unknown, ViewProps>(function View({ children, ...props }, ref) {
  return createElement('View', { ...props, ref }, children)
})

export const Text = forwardRef<unknown, TextProps>(function Text({ children, ...props }, ref) {
  return createElement('Text', { ...props, ref }, children)
})

export const TouchableOpacity = forwardRef<unknown, TouchableOpacityProps>(
  function TouchableOpacity({ children, ...props }, ref) {
    return createElement('TouchableOpacity', { ...props, ref }, children)
  }
)

type StyleObject = Record<string, unknown>

export const StyleSheet = {
  create: <T extends Record<string, StyleObject>>(styles: T): T => styles,
  absoluteFillObject: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0
  } as const
}

export const Platform = {
  OS: 'ios' as const,
  select: <T>(specifics: { ios?: T; android?: T; default?: T }): T | undefined => {
    return specifics.ios ?? specifics.default
  }
}

export type StyleProp<T> = T | T[] | null | undefined

export interface ViewStyle {
  [key: string]: unknown
}

export type { ViewProps }
