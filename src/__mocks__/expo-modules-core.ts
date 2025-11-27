import React, { forwardRef, ReactNode } from 'react'

interface MockViewProps {
  children?: ReactNode
  [key: string]: unknown
}

export const requireNativeViewManager = jest.fn(() => {
  return forwardRef<unknown, MockViewProps>(function MockNativeView({ children, ...props }, ref) {
    return React.createElement('NativeSwipeableView', { ...props, ref }, children as ReactNode)
  })
})

export const requireNativeModule = jest.fn(() => ({
  openByKey: jest.fn(),
  closeByKey: jest.fn(),
  closeAll: jest.fn()
}))
