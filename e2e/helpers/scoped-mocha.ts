import { withCommandAttempt } from './command-scope'

type Registration = 'it' | 'before' | 'beforeEach' | 'after' | 'afterEach'

/**
 * This adapter sees the original callback BEFORE WDIO wraps registration.
 * executeAsync invokes that callback again for each supported internal retry.
 * Resolve globals lazily because WDIO refreshes its BDD interface per spec file.
 */
function registration<Name extends Registration>(name: Name): (typeof globalThis)[Name] {
  const invoke = (target: (...args: never[]) => unknown, args: unknown[]) =>
    Reflect.apply(
      target,
      undefined,
      args.map((arg) =>
        typeof arg === 'function' ? withCommandAttempt(arg as (...args: never[]) => unknown) : arg
      )
    )
  return new Proxy((...args: unknown[]) => invoke(globalThis[name], args), {
    get(_target, key) {
      const value = Reflect.get(globalThis[name], key)
      if ((key === 'only' || key === 'skip') && typeof value === 'function') {
        return (...args: unknown[]) => invoke(value as (...args: never[]) => unknown, args)
      }
      return typeof value === 'function' ? value.bind(globalThis[name]) : value
    }
  }) as unknown as (typeof globalThis)[Name]
}

export const it = registration('it')
export const before = registration('before')
export const beforeEach = registration('beforeEach')
export const after = registration('after')
export const afterEach = registration('afterEach')
