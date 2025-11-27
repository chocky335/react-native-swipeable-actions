import type { ReactNode, ReactElement, Ref, ComponentType } from 'react'

type MockRef<T> = { current: T | null }

function createRef<T>(): MockRef<T> {
  return { current: null }
}

function useRef<T>(initialValue: T | null = null): MockRef<T> {
  return { current: initialValue }
}

function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
  const value = typeof initial === 'function' ? (initial as () => T)() : initial
  return [value, () => {}]
}

function useCallback<T extends (...args: unknown[]) => unknown>(callback: T, _deps: unknown[]): T {
  return callback
}

function useMemo<T>(factory: () => T, _deps: unknown[]): T {
  return factory()
}

function useEffect(_effect: () => void | (() => void), _deps?: unknown[]): void {}

function useLayoutEffect(_effect: () => void | (() => void), _deps?: unknown[]): void {}

function useImperativeHandle<T>(
  _ref: Ref<T> | undefined,
  _init: () => T,
  _deps?: unknown[]
): void {}

interface ForwardRefExoticComponent<P> {
  (props: P): ReactElement | null
  $$typeof: symbol
  displayName?: string
  render: (props: P, ref: unknown) => ReactNode
}

function forwardRef<T, P>(
  render: (props: P, ref: Ref<T>) => ReactNode
): ForwardRefExoticComponent<P & { ref?: Ref<T> }> {
  const result = {
    $$typeof: Symbol.for('react.forward_ref'),
    render,
    displayName: render.name || 'ForwardRef'
  } as ForwardRefExoticComponent<P & { ref?: Ref<T> }>
  return result
}

function createElement(
  type: string | ComponentType<unknown>,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
): ReactElement {
  return {
    type,
    props: { ...props, children: children.length <= 1 ? children[0] : children },
    key: (props?.key as string) || null,
    ref: (props?.ref as Ref<unknown>) || null
  } as unknown as ReactElement
}

function isValidElement(object: unknown): object is ReactElement {
  return typeof object === 'object' && object !== null && 'type' in object && 'props' in object
}

const Children = {
  map: <T>(children: ReactNode, fn: (child: ReactNode, index: number) => T): T[] => {
    if (!children) return []
    if (Array.isArray(children)) {
      return children.map(fn)
    }
    return [fn(children, 0)]
  },
  forEach: (children: ReactNode, fn: (child: ReactNode, index: number) => void): void => {
    if (!children) return
    if (Array.isArray(children)) {
      children.forEach(fn)
    } else {
      fn(children, 0)
    }
  },
  count: (children: ReactNode): number => {
    if (!children) return 0
    if (Array.isArray(children)) return children.length
    return 1
  },
  only: (children: ReactNode): ReactElement => {
    if (!isValidElement(children)) {
      throw new Error('React.Children.only expected to receive a single React element child.')
    }
    return children
  },
  toArray: (children: ReactNode): ReactNode[] => {
    if (!children) return []
    if (Array.isArray(children)) return children
    return [children]
  }
}

const Fragment = Symbol.for('react.fragment')

const React = {
  createElement,
  createRef,
  forwardRef,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  isValidElement,
  Children,
  Fragment
}

export {
  createElement,
  createRef,
  forwardRef,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  isValidElement,
  Children,
  Fragment
}

export default React

export type { ReactNode, ReactElement, Ref, ComponentType }
