import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import type { Dispatcher } from 'undici'

type Scope = {
  title: string
  deadline: number
  controller: AbortController
  closed: boolean
  parent?: Scope
  children: Set<Scope>
  attempt?: Scope
  timer?: ReturnType<typeof setTimeout>
  timeoutFailure?: Error
  deadlineFailure?: Error
  deadlineOwner?: Scope
  observedFailure?: { error: unknown }
}
type Flight = { owner?: Scope; started: boolean }
type SuiteWithHooks = {
  _beforeAll: Mocha.Hook[]
  _beforeEach: Mocha.Hook[]
  _afterEach: Mocha.Hook[]
  _afterAll: Mocha.Hook[]
}
type Outcome = { passed: boolean; error?: unknown }

/** Each worker has one guard. Separate instances let regressions quarantine safely. */
export function createCommandGuard() {
  const ownership = new AsyncLocalStorage<Scope>()
  const wrapped = new WeakSet<Mocha.Runnable>()
  const pending = new Set<Flight>()
  const evidenceScopes = new Set<Scope>()
  let quarantine: Error | undefined

  function quarantineSession(reason: string): void {
    quarantine ??= new Error(`WebDriver session quarantined: ${reason}`)
  }

  function healthy(): void {
    if (quarantine) throw quarantine
  }

  function belongsTo(owner: Scope | undefined, scope: Scope): boolean {
    for (let current = owner; current; current = current.parent) {
      if (current === scope) return true
    }
    return false
  }

  function close(scope: Scope): void {
    if (scope.closed) return
    scope.closed = true
    evidenceScopes.delete(scope)
    clearTimeout(scope.timer)
    for (const child of scope.children) close(child)
    if ([...pending].some((flight) => belongsTo(flight.owner, scope))) {
      // Quarantine BEFORE abort: client cancellation is not server completion.
      quarantineSession(`unresolved request when "${scope.title}" ended`)
    }
    scope.controller.abort(
      originalTimeout(scope) ??
        deadlineTimeout(scope) ??
        new Error(`WebDriver scope ended: ${scope.title}`)
    )
  }

  function expire(scope: Scope): void {
    if (scope.closed) return
    const owner = scope.deadlineOwner ?? scope
    // Establish deadline attribution BEFORE quarantine/abort can reject a body.
    // This is our error, not a claim that Mocha already created a timeout object.
    owner.deadlineFailure ??=
      originalTimeout(owner) ??
      Object.assign(new Error(`Timeout: WebDriver scope deadline exceeded: ${owner.title}`), {
        name: 'WebDriverScopeTimeoutError',
        code: 'ERR_WEBDRIVER_SCOPE_TIMEOUT'
      })
    scope.deadlineFailure = owner.deadlineFailure
    close(scope)
  }

  function armDeadline(scope: Scope): void {
    if (scope.closed || !Number.isFinite(scope.deadline)) return
    const remaining = scope.deadline - performance.now()
    if (remaining <= 0) {
      expire(scope)
      return
    }
    // Keep the absolute deadline authoritative if a timer wakes early.
    scope.timer = setTimeout(() => armDeadline(scope), Math.ceil(remaining))
    scope.timer.unref()
  }

  function active(scope: Scope | undefined): void {
    healthy()
    for (let current = scope; current; current = current.parent) {
      if (current.closed || performance.now() >= current.deadline) {
        if (!current.closed) expire(current)
        healthy()
        throw new Error(`Rejected WebDriver command from expired scope: ${current.title}`)
      }
    }
  }

  function transportFailed(flight: Flight, error: unknown, reason: string): void {
    if (!pending.has(flight)) return
    // Only a refused connection, before any request lifecycle progress, proves
    // nonacceptance. Do not exempt other errors, causes, or unowned requests.
    if (
      !flight.started &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ECONNREFUSED' &&
      'syscall' in error &&
      error.syscall === 'connect'
    ) {
      pending.delete(flight)
      return
    }
    // Abort/error otherwise cannot establish remote completion.
    quarantineSession(reason)
  }

  function trackDispatcher(delegate: Dispatcher, owner: Scope | undefined): Dispatcher {
    return new Proxy(delegate, {
      get(target, key) {
        if (key !== 'dispatch') {
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) => {
          // Runs for every actual dispatch, including WDIO transport retries.
          active(owner)
          const flight: Flight = { owner, started: false }
          pending.add(flight)
          const trackedHandler = new Proxy(handler, {
            get(original, event) {
              if (event === 'onComplete') {
                return (
                  ...args: Parameters<NonNullable<Dispatcher.DispatchHandlers['onComplete']>>
                ) => {
                  pending.delete(flight)
                  return original.onComplete?.apply(original, args)
                }
              }
              if (event === 'onError') {
                return (error: Error) => {
                  transportFailed(
                    flight,
                    error,
                    'transport ended without a complete server response'
                  )
                  return original.onError?.call(original, error)
                }
              }
              const value = Reflect.get(original, event, original)
              if (
                event === 'onConnect' ||
                event === 'onBodySent' ||
                event === 'onRequestSent' ||
                event === 'onHeaders' ||
                event === 'onData' ||
                event === 'onUpgrade'
              ) {
                return (...args: unknown[]) => {
                  flight.started = true
                  return typeof value === 'function'
                    ? Reflect.apply(value, original, args)
                    : undefined
                }
              }
              return typeof value === 'function' ? value.bind(original) : value
            }
          })
          try {
            return target.dispatch(options, trackedHandler)
          } catch (error) {
            transportFailed(flight, error, 'dispatch failed without a complete server response')
            throw error
          }
        }
      }
    })
  }

  function guardRequest(options: RequestInit): RequestInit {
    const owner = ownership.getStore()
    active(owner)
    let signal = options.signal
    if (owner) {
      signal = signal ? AbortSignal.any([signal, owner.controller.signal]) : owner.controller.signal
    }
    const request = { ...options, signal }
    let dispatcher: Dispatcher | undefined
    // Installed Node WebDriver assigns its chosen dispatcher AFTER transformRequest.
    // Preserve that dispatcher (and its timeout/proxy settings), wrapping only dispatch.
    // _request then copies this enumerable property for fetch, including retries.
    return Object.defineProperty(request, 'dispatcher', {
      enumerable: true,
      configurable: true,
      get: () => dispatcher,
      set: (selected: Dispatcher) => {
        dispatcher = trackDispatcher(selected, owner)
      }
    })
  }

  function originalTimeout(scope: Scope | undefined): Error | undefined {
    for (let current = scope; current; current = current.parent) {
      if (current.timeoutFailure) return current.timeoutFailure
    }
  }

  function deadlineTimeout(scope: Scope | undefined): Error | undefined {
    for (let current = scope; current; current = current.parent) {
      const failure = current.deadlineFailure ?? current.deadlineOwner?.deadlineFailure
      if (failure) return failure
    }
  }

  function knownFailure(scope: Scope | undefined, error: unknown): boolean {
    for (let current = scope; current; current = current.parent) {
      for (const observed of [current.observedFailure, current.attempt?.observedFailure]) {
        if (observed && observed.error === error) return true
      }
    }
    return false
  }

  function finishCommandScope<Args extends unknown[], Result>(
    callback: (...args: Args) => Result
  ): (...args: Args) => Promise<Awaited<Result>> {
    return async function (this: unknown, ...args: Args): Promise<Awaited<Result>> {
      const scope = ownership.getStore()
      let canCapture = scope !== undefined
      for (let current = scope; current; current = current.parent) {
        if (!current.closed && performance.now() >= current.deadline) expire(current)
        if (current.closed) canCapture = false
      }
      if (scope) close(scope)
      const outcome = args.find(
        (arg): arg is Args[number] & Outcome =>
          typeof arg === 'object' && arg !== null && 'passed' in arg
      )
      const timeout =
        originalTimeout(scope) ??
        (knownFailure(scope, outcome?.error) ? undefined : deadlineTimeout(scope))
      if (outcome && timeout) {
        outcome.error = timeout
        outcome.passed = false
      }
      if (quarantine && outcome && !outcome.error) {
        outcome.error = quarantine
        outcome.passed = false
      }
      // Evidence gets separate authority, never an unowned escape. Its budget is
      // only what remains of this invocation's deadline, not a new timeout.
      const evidence = newScope(
        scope?.title ?? 'unowned evidence',
        scope?.deadline ?? performance.now()
      )
      evidence.deadlineOwner = scope?.deadlineOwner ?? scope
      evidenceScopes.add(evidence)
      if (!canCapture) {
        close(evidence)
      } else {
        armDeadline(evidence)
      }
      try {
        // Even an expired/quarantined callback may finish local outcome logging.
        // Only its HTTP authority is revoked, including detached continuations.
        return await ownership.run(evidence, () => callback.apply(this, args))
      } finally {
        close(evidence)
      }
    }
  }

  function newScope(title: string, deadline: number, parent?: Scope): Scope {
    const scope: Scope = {
      title,
      deadline,
      parent,
      children: new Set(),
      controller: new AbortController(),
      closed: false
    }
    parent?.children.add(scope)
    return scope
  }

  async function runOwned(scope: Scope, body: () => unknown): Promise<unknown> {
    return ownership.run(scope, async () => {
      let result: unknown
      try {
        result = await body()
      } catch (error) {
        const frameworkTimeout = originalTimeout(scope)
        const deadline = deadlineTimeout(scope)
        if (!frameworkTimeout && !deadline) scope.observedFailure = { error }
        // An assertion already observed in this attempt stays the same object.
        // A cancellation induced by expiry instead reports the deadline cause.
        throw frameworkTimeout ?? (knownFailure(scope, error) ? error : (deadline ?? error))
      } finally {
        if (!scope.closed && performance.now() >= scope.deadline) expire(scope)
        close(scope)
      }
      // WDIO config-hook errors can be swallowed. Enforce failure after a
      // successful body too; an earlier assertion/timeout already exited above.
      const timeout = originalTimeout(scope) ?? deadlineTimeout(scope)
      if (timeout) throw timeout
      healthy()
      return result
    })
  }

  function withCommandAttempt<T extends (...args: never[]) => unknown>(body: T): T {
    return function (this: unknown, ...args: unknown[]) {
      const parent = ownership.getStore()
      if (!parent) throw new Error('WDIO attempt has no enclosing runnable scope')
      // executeAsync retries internally before afterTest. Its previous invocation
      // may still be waiting, so retire it BEFORE granting the retry any authority.
      if (parent.attempt) close(parent.attempt)
      active(parent)
      const scope = newScope(parent.title, parent.deadline, parent)
      parent.attempt = scope
      return runOwned(scope, () => Reflect.apply(body, this, args))
    } as unknown as T
  }

  function wrap(runnable: Mocha.Runnable): void {
    const original = runnable.fn
    if (!original || wrapped.has(runnable)) return
    wrapped.add(runnable)
    runnable.fn = function (this: Mocha.Context) {
      // Native Mocha retries clone the test but retain this function. Capture the
      // executing clone once, before any asynchronous work mutates the context.
      const currentRunnable = this.runnable()
      for (const evidence of evidenceScopes) close(evidence)
      healthy()
      // Never reuse a session with unresolved work from an earlier phase.
      if (pending.size > 0) {
        quarantineSession('a new runnable began with unresolved requests')
        healthy()
      }
      const timeout = currentRunnable.timeout()
      const scope = newScope(
        currentRunnable.fullTitle(),
        timeout > 0 ? performance.now() + timeout : Infinity
      )
      armDeadline(scope)
      // Mocha can finish this runnable before WDIO reports its abandoned body.
      // Capture the exact timeout object at completion, before the next case runs.
      // No timer is rescheduled and the original callback is always forwarded.
      type Completion = (this: unknown, ...args: unknown[]) => unknown
      const target = currentRunnable as unknown as { callback: Completion }
      const completion = target.callback
      const captureTimeout: Completion = function (...args) {
        const error = args[0]
        if (error instanceof Error && 'code' in error && error.code === 'ERR_MOCHA_TIMEOUT') {
          scope.timeoutFailure ??= error
        }
        return Reflect.apply(completion, this, args)
      }
      target.callback = captureTimeout
      return runOwned(scope, () => (original as Mocha.AsyncFunc).call(this)).finally(() => {
        // A later invocation may already have installed its own callback.
        if (target.callback === captureTimeout) target.callback = completion
      })
    }
  }

  function wrapSuite(suite: Mocha.Suite): void {
    const hooks = suite as unknown as SuiteWithHooks
    for (const runnable of [
      ...suite.tests,
      ...hooks._beforeAll,
      ...hooks._beforeEach,
      ...hooks._afterEach,
      ...hooks._afterAll
    ]) {
      wrap(runnable)
    }
    for (const child of suite.suites) wrapSuite(child)
  }

  const mochaHooks = {
    beforeAll(this: Mocha.Context): void {
      const root = this.test?.parent
      if (!root) throw new Error('Cannot install WebDriver command ownership without a root suite')
      wrapSuite(root)
    }
  }
  return { guardRequest, finishCommandScope, withCommandAttempt, mochaHooks }
}

export const { guardRequest, finishCommandScope, withCommandAttempt, mochaHooks } =
  createCommandGuard()
