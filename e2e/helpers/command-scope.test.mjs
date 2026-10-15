import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { testFnWrapper, wrapCommand, wrapGlobalTestMethod } from '@wdio/utils'
import Mocha from 'mocha'
import { Agent, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import WebDriver from 'webdriver'
import commandScope from './command-scope.ts'
import scopedMocha from './scoped-mocha.ts'

const { createCommandGuard, finishCommandScope, guardRequest, withCommandAttempt } = commandScope

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(timeout = 100, guard = commandScope) {
  const mocha = new Mocha({
    timeout,
    reporter: class SilentReporter {},
    rootHooks: guard.mochaHooks
  })
  return {
    suite: mocha.suite,
    add(title, body) {
      const runnable = new Mocha.Test(title, body)
      mocha.suite.addTest(runnable)
      return runnable
    },
    run(onFailure = () => {}) {
      return new Promise((resolve) => mocha.run(resolve).on('fail', onFailure))
    }
  }
}

function wdio(body, after = async () => {}, before = []) {
  return function () {
    return testFnWrapper.call(
      this,
      'Test',
      { specFn: withCommandAttempt(body), specFnArgs: [] },
      { beforeFn: before, beforeFnArgs: () => [] },
      { afterFn: [finishCommandScope(after)], afterFnArgs: () => [] },
      'scope-regression'
    )
  }
}

test('command ownership with the installed Mocha and WDIO transport', async (t) => {
  const previous = getGlobalDispatcher()
  // WDIO deliberately ignores a dispatcher named MockAgent; a custom dispatcher
  // subclass uses its supported custom-dispatcher path. No sockets are opened.
  class ScopeMockAgent extends MockAgent {}
  const agent = new ScopeMockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  const requests = []
  const pool = agent.get('http://scope.invalid')
  for (const method of ['GET', 'POST', 'DELETE']) {
    pool
      .intercept({ path: /.*/, method })
      .reply((request) => {
        requests.push({ method, path: request.path })
        let value = null
        if (request.path.endsWith('/rect')) value = { x: 12, y: 24, width: 120, height: 100 }
        else if (request.path.endsWith('/source')) value = '<hierarchy/>'
        return { statusCode: 200, data: JSON.stringify({ value }) }
      })
      .persist()
  }
  const driver = WebDriver.attachToSession({
    sessionId: 'scope-regression',
    hostname: 'scope.invalid',
    port: 80,
    protocol: 'http',
    path: '/',
    capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
    logLevel: 'silent',
    connectionRetryCount: 1,
    transformRequest: guardRequest
  })

  try {
    await t.test(
      'expired WDIO continuation cannot send actions; next case and cleanup can',
      async () => {
        const gate = deferred()
        const resumed = deferred()
        const outcomes = []
        const recorded = deferred()
        let runnerTimeout
        let staleError
        let cleanupCount = 0
        const f = fixture(150)
        f.suite.afterEach('cleanup', async () => {
          await driver.releaseActions()
          cleanupCount++
        })
        f.add(
          'times out',
          wdio(
            async () => {
              await driver.getElementRect('frame')
              await gate.promise
              try {
                await driver.performActions([])
              } catch (error) {
                staleError = error
                throw error
              } finally {
                resumed.resolve()
              }
            },
            async (result) => {
              outcomes.push(result)
              try {
                await assert.rejects(driver.getPageSource(), /expired scope: times out/)
              } finally {
                recorded.resolve()
              }
            },
            // Same 150 ms budgets; setup makes the OUTER timer win rather than
            // relying on WDIO's nominal three-millisecond evidence margin.
            [
              async () => {
                await delay(15)
              }
            ]
          )
        )
        f.add(
          'next case',
          wdio(async () => {
            const before = requests.length
            gate.resolve()
            await resumed.promise
            await recorded.promise
            assert.match(staleError.message, /expired scope: times out/)
            assert.equal(requests.length, before)
            await driver.performActions([])
          })
        )
        const start = requests.length
        assert.equal(
          await f.run((runnable, error) => {
            if (runnable.title === 'times out') runnerTimeout = error
          }),
          1
        )
        assert.equal(runnerTimeout.code, 'ERR_MOCHA_TIMEOUT')
        assert.equal(outcomes[0].error, runnerTimeout)
        assert.equal(outcomes.length, 1)
        assert.match(outcomes[0].error.message, /Timeout/)
        assert.equal(outcomes[0].passed, false)
        assert.equal(cleanupCount, 2)
        assert.equal(requests.slice(start).filter((r) => r.method === 'POST').length, 1)
        assert.equal(requests.slice(start).filter((r) => r.path.endsWith('/source')).length, 0)
      }
    )

    await t.test('Mocha timeout expires its original owner even without afterTest', async () => {
      const gate = deferred()
      const resumed = deferred()
      let staleError
      let oldSignal
      const f = fixture(50)
      f.add('outer timeout', async () => {
        oldSignal = guardRequest({}).signal
        await gate.promise
        try {
          await driver.performActions([])
        } catch (error) {
          staleError = error
        } finally {
          resumed.resolve()
        }
      })
      f.add('fresh owner', async () => {
        assert.equal(oldSignal.aborted, true)
        gate.resolve()
        await resumed.promise
        assert.match(staleError.message, /expired scope: outer timeout/)
        await driver.getElementRect('fresh')
      })
      assert.equal(await f.run(), 1)
    })

    await t.test(
      'ordinary assertion failures retain their original error and failed outcome',
      async () => {
        const expected = new Error('original assertion failure')
        let result
        let reported
        let cleanups = 0
        const start = requests.length
        const f = fixture()
        f.suite.afterEach('assertion cleanup', async () => {
          await driver.releaseActions()
          cleanups++
        })
        f.add(
          'assertion fails',
          wdio(
            async () => {
              throw expected
            },
            async (outcome) => {
              result = outcome
              assert.equal(await driver.getPageSource(), '<hierarchy/>')
            }
          )
        ).on('error', (error) => {
          reported = error
        })
        f.add(
          'healthy case after assertion evidence',
          wdio(async () => {
            await driver.performActions([])
          })
        )
        let runnerError
        assert.equal(
          await f.run((runnable, error) => {
            if (runnable.title === 'assertion fails') runnerError = error
          }),
          1
        )
        assert.equal(runnerError, expected)
        assert.equal(requests.slice(start).filter((r) => r.path.endsWith('/source')).length, 1)
        assert.equal(requests.slice(start).filter((r) => r.method === 'POST').length, 1)
        assert.equal(cleanups, 2)
        assert.equal(result.error, expected)
        assert.equal(result.passed, false)
        assert.equal(reported, undefined)
      }
    )

    await t.test('successful completion also retires detached work', async () => {
      const gate = deferred()
      let detached
      const f = fixture()
      f.add('launches detached continuation', async () => {
        detached = gate.promise.then(() => driver.performActions([]))
      })
      f.add('next owner', async () => {
        const rejection = assert.rejects(detached, /expired scope/)
        gate.resolve()
        await rejection
        await driver.getPageSource()
      })
      assert.equal(await f.run(), 0)
    })

    await t.test('delayed WDIO command dispatch still checks the original owner', async () => {
      const gate = deferred()
      const started = deferred()
      let pending
      const command = wrapCommand('delayedAction', async () => {
        started.resolve()
        await gate.promise
        return driver.performActions([])
      })
      const f = fixture(50)
      f.add('waits in a command', async () => {
        pending = command.call({ options: {} })
        await pending
      })
      f.add('next case after delayed command', async () => {
        await started.promise
        const rejection = assert.rejects(pending, /expired scope/)
        gate.resolve()
        await rejection
        await driver.getPageSource()
      })
      assert.equal(await f.run(), 1)
    })

    await t.test(
      'actual WDIO registration isolates internal retries without disabling them',
      async () => {
        const gate = deferred()
        let stale
        let attempts = 0
        let outcome
        const start = requests.length
        const f = fixture(300)
        const previousIt = globalThis.it
        try {
          globalThis.it = (title, body) => f.add(title, body)
          wrapGlobalTestMethod(
            true,
            [],
            () => [],
            [
              finishCommandScope(async (result) => {
                outcome = result
              })
            ],
            () => [],
            'it',
            'retry-regression'
          )
          scopedMocha.it(
            'retries its original callback',
            async () => {
              attempts++
              if (attempts === 1) {
                stale = gate.promise.then(() => driver.performActions([]))
                throw new Error('first attempt assertion')
              }
              const rejection = assert.rejects(stale, /expired scope/)
              gate.resolve()
              await rejection
              await driver.performActions([])
            },
            1
          )
        } finally {
          globalThis.it = previousIt
        }
        assert.equal(await f.run(), 0)
        assert.equal(attempts, 2)
        assert.equal(outcome.passed, true)
        assert.equal(outcome.retries.attempts, 1)
        assert.equal(requests.slice(start).filter((r) => r.method === 'POST').length, 1)
      }
    )

    for (const mode of ['timeout', 'detached-success']) {
      await t.test(
        `accepted unresolved action quarantines cleanup and later cases: ${mode}`,
        async () => {
          const guard = createCommandGuard()
          const isolated = new ScopeMockAgent()
          isolated.disableNetConnect()
          const accepted = deferred()
          const completed = deferred()
          const calls = []
          let serverActive = false
          let outcome
          let evidenceError
          let nextRan = false
          const isolatedPool = isolated.get('http://scope.invalid')
          isolatedPool
            .intercept({
              path: '/session/quarantine/actions',
              method: 'POST'
            })
            .reply(() => {
              calls.push('old-action-accepted')
              serverActive = true
              accepted.resolve()
              // This simulated server keeps working even when the client aborts.
              setTimeout(() => {
                serverActive = false
                calls.push('old-action-completed')
                completed.resolve()
              }, 120)
              return { statusCode: 200, data: JSON.stringify({ value: null }) }
            })
            .delay(120)
          for (const method of ['GET', 'DELETE', 'POST']) {
            isolatedPool
              .intercept({ path: /.*/, method })
              .reply(() => {
                calls.push(`other-request-while-old-active=${serverActive}`)
                return { statusCode: 200, data: JSON.stringify({ value: null }) }
              })
              .persist()
          }
          setGlobalDispatcher(isolated)
          const isolatedDriver = WebDriver.attachToSession({
            sessionId: 'quarantine',
            hostname: 'scope.invalid',
            port: 80,
            protocol: 'http',
            path: '/',
            capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
            logLevel: 'silent',
            connectionRetryCount: 1,
            transformRequest: guard.guardRequest
          })
          try {
            const f = fixture(50, guard)
            f.suite.afterEach('cleanup', async () => {
              await isolatedDriver.releaseActions()
            })
            f.add('accepted action', function () {
              return testFnWrapper.call(
                this,
                'Test',
                {
                  specFn: guard.withCommandAttempt(async () => {
                    const action = isolatedDriver.performActions([])
                    // Attach rejection handling even in the detached-success case.
                    const settled = action.catch((error) => {
                      throw error
                    })
                    settled.catch(() => {})
                    await accepted.promise
                    if (mode === 'timeout') await settled
                  }),
                  specFnArgs: []
                },
                { beforeFn: [], beforeFnArgs: () => [] },
                {
                  afterFn: [
                    guard.finishCommandScope(async (result) => {
                      outcome = result
                      try {
                        await isolatedDriver.getPageSource()
                      } catch (error) {
                        evidenceError = error
                      }
                    })
                  ],
                  afterFnArgs: () => []
                },
                'quarantine-regression'
              )
            })
            f.add('next case must not reuse the session', async () => {
              nextRan = true
              await isolatedDriver.performActions([])
            })
            assert.ok((await f.run()) > 0)
            assert.equal(outcome.passed, false)
            assert.match(outcome.error.message, mode === 'timeout' ? /Timeout/ : /quarantined/)
            assert.match(evidenceError.message, /quarantined/)
            assert.equal(nextRan, false)
            await assert.rejects(isolatedDriver.releaseActions(), /quarantined/)
            assert.deepEqual(calls, ['old-action-accepted'])
            await completed.promise
            assert.deepEqual(calls, ['old-action-accepted', 'old-action-completed'])
            // A late response is never used to reopen this worker's session.
            await assert.rejects(isolatedDriver.getPageSource(), /quarantined/)
          } finally {
            setGlobalDispatcher(agent)
            await isolated.close()
          }
        }
      )
    }

    await t.test('request cancellation composes with the existing transport signal', async () => {
      const f = fixture()
      let scopedSignal
      const existing = new AbortController()
      f.add('captures a request signal', async () => {
        scopedSignal = guardRequest({ signal: existing.signal }).signal
        assert.equal(scopedSignal.aborted, false)
        existing.abort()
        assert.equal(scopedSignal.aborted, true)
      })
      assert.equal(await f.run(), 0)
      const options = { method: 'GET' }
      assert.equal(guardRequest(options).method, options.method)
      await delay(0)
    })
  } finally {
    setGlobalDispatcher(previous)
    await agent.close()
  }
})

test('late WDIO reporting retains the original Mocha timeout object', async () => {
  const guard = createCommandGuard()
  const mocha = new Mocha({
    timeout: 40,
    reporter: class SilentReporter {},
    rootHooks: guard.mochaHooks
  })
  const gate = deferred()
  const reported = deferred()
  let originalError
  let outcome
  const first = new Mocha.Test('outer timeout before WDIO timeout', function () {
    return testFnWrapper.call(
      this,
      'Test',
      {
        specFn: guard.withCommandAttempt(async () => {
          await gate.promise
          guard.guardRequest({})
        }),
        specFnArgs: []
      },
      {
        // Deterministically let the existing outer deadline win first.
        beforeFn: [
          async () => {
            await delay(15)
          }
        ],
        beforeFnArgs: () => []
      },
      {
        afterFn: [
          guard.finishCommandScope((result) => {
            outcome = result
            reported.resolve()
          })
        ],
        afterFnArgs: () => []
      },
      'timeout-outcome-regression'
    )
  })
  mocha.suite.addTest(first)
  mocha.suite.addTest(
    new Mocha.Test('resume the abandoned body', async () => {
      gate.resolve()
      await reported.promise
    })
  )
  const failures = await new Promise((resolve) => {
    mocha.run(resolve).on('fail', (runnable, error) => {
      if (runnable === first) originalError = error
    })
  })
  assert.equal(failures, 1)
  assert.match(originalError.message, /Timeout/)
  assert.equal(outcome.error, originalError)
  assert.equal(outcome.passed, false)
})

function isolatedWdio(guard, body, after = async () => {}) {
  return function () {
    return testFnWrapper.call(
      this,
      'Test',
      { specFn: guard.withCommandAttempt(body), specFnArgs: [] },
      { beforeFn: [], beforeFnArgs: () => [] },
      { afterFn: [guard.finishCommandScope(after)], afterFnArgs: () => [] },
      'round-three-regression'
    )
  }
}

test('proven connect refusal preserves actual WebDriver session startup retries', async () => {
  const previous = getGlobalDispatcher()
  class StartupMockAgent extends MockAgent {}
  try {
    for (const guarded of [false, true]) {
      const agent = new StartupMockAgent()
      agent.disableNetConnect()
      setGlobalDispatcher(agent)
      const pool = agent.get('http://startup.invalid')
      const refusal = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        syscall: 'connect'
      })
      pool.intercept({ path: '/session', method: 'POST' }).replyWithError(refusal)
      let successfulRequests = 0
      pool.intercept({ path: '/session', method: 'POST' }).reply(() => {
        successfulRequests++
        return {
          statusCode: 200,
          data: JSON.stringify({ value: { sessionId: 'startup', capabilities: {} } })
        }
      })
      const guard = createCommandGuard()
      try {
        const driver = await WebDriver.newSession({
          hostname: 'startup.invalid',
          port: 80,
          protocol: 'http',
          path: '/',
          capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
          logLevel: 'silent',
          connectionRetryCount: 3,
          ...(guarded ? { transformRequest: guard.guardRequest } : {})
        })
        assert.equal(driver.sessionId, 'startup')
        assert.equal(successfulRequests, 1)
        agent.assertNoPendingInterceptors()
      } finally {
        await agent.close()
      }
    }
  } finally {
    setGlobalDispatcher(previous)
  }
})

test('only proven preaccept refusal retires a failed dispatch', () => {
  for (const mode of ['sync-refusal', 'missing-phase', 'reset', 'started-refusal']) {
    const guard = createCommandGuard()
    const error = Object.assign(new Error(mode), {
      code: mode === 'reset' ? 'ECONNRESET' : 'ECONNREFUSED',
      ...(mode === 'missing-phase' ? {} : { syscall: 'connect' })
    })
    const request = guard.guardRequest({})
    let reported
    request.dispatcher = {
      dispatch(_options, handler) {
        if (mode === 'sync-refusal') throw error
        if (mode === 'started-refusal') handler.onConnect(() => {})
        handler.onError(error)
        return true
      }
    }
    const dispatch = () =>
      request.dispatcher.dispatch(
        {},
        {
          onError(failure) {
            reported = failure
          }
        }
      )
    if (mode === 'sync-refusal') {
      assert.throws(dispatch, (failure) => failure === error)
      assert.doesNotThrow(() => guard.guardRequest({}))
    } else {
      dispatch()
      assert.equal(reported, error)
      assert.throws(() => guard.guardRequest({}), /quarantined/)
    }
  }
})

test('evidence callback authority is bounded, revocable, and usable while healthy', async (t) => {
  const previous = getGlobalDispatcher()
  class EvidenceMockAgent extends MockAgent {}
  const agent = new EvidenceMockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  const requests = []
  for (const method of ['GET', 'DELETE']) {
    agent
      .get('http://evidence.invalid')
      .intercept({ path: /.*/, method })
      .reply((request) => {
        requests.push({ method, path: request.path })
        return { statusCode: 200, data: JSON.stringify({ value: '<hierarchy/>' }) }
      })
      .persist()
  }
  function session(guard) {
    return WebDriver.attachToSession({
      sessionId: 'evidence',
      hostname: 'evidence.invalid',
      port: 80,
      protocol: 'http',
      path: '/',
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
      logLevel: 'silent',
      connectionRetryCount: 1,
      transformRequest: guard.guardRequest
    })
  }
  try {
    await t.test('timed-out callback cannot dispatch after next case begins', async () => {
      const guard = createCommandGuard()
      const driver = session(guard)
      const gate = deferred()
      const resumed = deferred()
      let staleError
      let localRecords = 0
      let cleanups = 0
      const start = requests.length
      const f = fixture(50, guard)
      f.suite.afterEach('healthy cleanup', async () => {
        await driver.releaseActions()
        cleanups++
      })
      f.add(
        'evidence waits past its deadline',
        isolatedWdio(
          guard,
          async () => {},
          async () => {
            await gate.promise
            localRecords++
            try {
              await driver.releaseActions()
            } catch (error) {
              staleError = error
            } finally {
              resumed.resolve()
            }
          }
        )
      )
      f.add(
        'next case releases old evidence',
        isolatedWdio(guard, async () => {
          const before = requests.length
          gate.resolve()
          await resumed.promise
          assert.match(staleError.message, /expired scope: evidence waits past its deadline/)
          assert.equal(requests.length, before)
          assert.equal(await driver.getPageSource(), '<hierarchy/>')
        })
      )
      assert.equal(await f.run(), 1)
      assert.equal(localRecords, 1)
      assert.equal(cleanups, 2)
      assert.equal(requests.slice(start).filter((r) => r.method === 'DELETE').length, 2)
      assert.equal(requests.slice(start).filter((r) => r.method === 'GET').length, 1)
    })

    await t.test('successful callback also revokes its detached continuation', async () => {
      const guard = createCommandGuard()
      const driver = session(guard)
      const gate = deferred()
      let detached
      const f = fixture(100, guard)
      f.add(
        'evidence finishes with detached work',
        isolatedWdio(
          guard,
          async () => {},
          () => {
            detached = gate.promise.then(() => driver.releaseActions())
          }
        )
      )
      f.add(
        'next case after successful evidence',
        isolatedWdio(guard, async () => {
          const before = requests.length
          const rejected = assert.rejects(detached, /expired scope/)
          gate.resolve()
          await rejected
          assert.equal(requests.length, before)
          await driver.getPageSource()
        })
      )
      assert.equal(await f.run(), 0)
    })

    await t.test('awaited healthy hook and test evidence retains transport authority', async () => {
      const guard = createCommandGuard()
      const driver = session(guard)
      const f = fixture(100, guard)
      const phases = []
      const start = requests.length
      const evidence = (phase) =>
        guard.finishCommandScope(async () => {
          await delay(0)
          assert.equal(await driver.getPageSource(), '<hierarchy/>')
          phases.push(phase)
        })
      f.suite.beforeAll('healthy before', evidence('before'))
      f.suite.beforeEach('healthy beforeEach', evidence('beforeEach'))
      f.suite.afterEach('healthy afterEach', evidence('afterEach'))
      f.suite.afterAll('healthy after', evidence('after'))
      for (const name of ['one', 'two']) {
        f.add(
          name,
          isolatedWdio(
            guard,
            async () => {},
            async (outcome) => {
              assert.equal(outcome.passed, true)
              await delay(0)
              assert.equal(await driver.getPageSource(), '<hierarchy/>')
              phases.push(name)
            }
          )
        )
      }
      assert.equal(await f.run(), 0)
      assert.deepEqual(phases, [
        'before',
        'beforeEach',
        'one',
        'afterEach',
        'beforeEach',
        'two',
        'afterEach',
        'after'
      ])
      assert.equal(requests.length - start, 8)
    })
  } finally {
    setGlobalDispatcher(previous)
    await agent.close()
  }
})

test('native Mocha retry clone retains its exact outer timeout during late reporting', async () => {
  const guard = createCommandGuard()
  const mocha = new Mocha({
    timeout: 50,
    reporter: class SilentReporter {},
    rootHooks: guard.mochaHooks
  })
  const gate = deferred()
  const reported = deferred()
  const initialFailure = new Error('first native attempt assertion')
  const outcomes = []
  let attempts = 0
  let failedRunnable
  let originalError
  const first = new Mocha.Test('Mocha retry outer timeout', function () {
    return testFnWrapper.call(
      this,
      'Test',
      {
        specFn: guard.withCommandAttempt(async () => {
          attempts++
          if (attempts === 1) throw initialFailure
          await gate.promise
          guard.guardRequest({})
        }),
        specFnArgs: []
      },
      {
        beforeFn: [
          async () => {
            await delay(15)
          }
        ],
        beforeFnArgs: () => []
      },
      {
        afterFn: [
          guard.finishCommandScope((outcome) => {
            outcomes.push(outcome)
            if (attempts === 2) reported.resolve()
          })
        ],
        afterFnArgs: () => []
      },
      'native-retry-timeout-regression'
    )
  })
  mocha.suite.addTest(first)
  first.retries(1)
  mocha.suite.addTest(
    new Mocha.Test('resume the abandoned native retry', async () => {
      gate.resolve()
      await reported.promise
    })
  )
  const failures = await new Promise((resolve) => {
    mocha.run(resolve).on('fail', (runnable, error) => {
      if (runnable.title === first.title) {
        failedRunnable = runnable
        originalError = error
      }
    })
  })
  assert.equal(attempts, 2)
  assert.equal(failures, 1)
  assert.notEqual(failedRunnable, first)
  assert.equal(failedRunnable.currentRetry(), 1)
  assert.equal(originalError.code, 'ERR_MOCHA_TIMEOUT')
  assert.equal(outcomes.length, 2)
  assert.equal(outcomes[0].error, initialFailure)
  assert.equal(outcomes[1].error, originalError)
  assert.equal(outcomes[1].passed, false)
})

test('real Undici accepted requests keep deadline attribution and quarantine', async (t) => {
  const previous = getGlobalDispatcher()
  try {
    for (const nativeRetry of [false, true]) {
      await t.test(
        nativeRetry
          ? 'native retry accepted-request deadline'
          : 'first-attempt accepted-request deadline',
        async () => {
          const guard = createCommandGuard()
          const trace = []
          const outcomes = []
          const reported = deferred()
          let accepted = false
          let attempts = 0
          let nextRan = false
          let rawTransportError
          let evidenceError
          let cleanupError
          let runnerError
          let failedRunnable
          const initialFailure = new Error('first native attempt assertion before accepted request')
          // Real Undici HTTP/cancellation logic, with an injected entirely in-memory
          // connector. No DNS, sockets, mock handler ordering, or server response.
          class MemorySocket extends Duplex {
            received = ''
            _read() {}
            _write(chunk, _encoding, callback) {
              this.received += chunk.toString()
              const boundary = this.received.indexOf('\r\n\r\n')
              if (boundary >= 0) {
                const headers = this.received.slice(0, boundary)
                const length = Number(/content-length: (\d+)/i.exec(headers)?.[1] ?? 0)
                if (!accepted && Buffer.byteLength(this.received.slice(boundary + 4)) >= length) {
                  accepted = true
                  trace.push('server-accepted')
                }
              }
              callback()
            }
            setNoDelay() {
              return this
            }
            setKeepAlive() {
              return this
            }
            setTimeout() {
              return this
            }
            ref() {
              return this
            }
            unref() {
              return this
            }
          }
          class InMemoryAgent extends Agent {
            dispatch(options, handler) {
              trace.push(options.method + ' ' + options.path)
              return super.dispatch(
                options,
                new Proxy(handler, {
                  get(target, event) {
                    const value = Reflect.get(target, event, target)
                    if (event === 'onError' || event === 'onComplete') {
                      return (...args) => {
                        trace.push(event)
                        return value?.apply(target, args)
                      }
                    }
                    return typeof value === 'function' ? value.bind(target) : value
                  }
                })
              )
            }
          }
          const agent = new InMemoryAgent({
            connect(_options, callback) {
              const socket = new MemorySocket()
              queueMicrotask(() => callback(null, socket))
              return socket
            }
          })
          setGlobalDispatcher(agent)
          const driver = WebDriver.attachToSession({
            sessionId: 'deadline',
            hostname: 'memory.invalid',
            port: 80,
            protocol: 'http',
            path: '/',
            capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
            logLevel: 'silent',
            connectionRetryCount: 0,
            transformRequest: guard.guardRequest
          })
          const mocha = new Mocha({
            timeout: 70,
            reporter: class SilentReporter {},
            rootHooks: guard.mochaHooks
          })
          const first = new Mocha.Test('outer deadline with accepted request', function () {
            return testFnWrapper.call(
              this,
              'Test',
              {
                specFn: guard.withCommandAttempt(async () => {
                  attempts++
                  if (nativeRetry && attempts === 1) throw initialFailure
                  try {
                    await driver.performActions([])
                  } catch (error) {
                    rawTransportError = error
                    throw error
                  }
                }),
                specFnArgs: []
              },
              {
                beforeFn: [
                  async () => {
                    await delay(15)
                  }
                ],
                beforeFnArgs: () => []
              },
              {
                afterFn: [
                  guard.finishCommandScope(async (outcome) => {
                    outcomes.push(outcome)
                    if (!accepted) return
                    try {
                      await driver.getPageSource()
                    } catch (error) {
                      evidenceError = error
                    }
                    try {
                      await driver.releaseActions()
                    } catch (error) {
                      cleanupError = error
                    } finally {
                      reported.resolve()
                    }
                  })
                ],
                afterFnArgs: () => []
              },
              'real-undici-deadline-regression'
            )
          })
          mocha.suite.addTest(first)
          if (nativeRetry) first.retries(1)
          mocha.suite.addTest(
            new Mocha.Test('blocked next owner', async () => {
              nextRan = true
              await driver.performActions([])
            })
          )
          try {
            const failures = await new Promise((resolve) => {
              mocha.run(resolve).on('fail', (runnable, error) => {
                if (runnable.title === first.title) {
                  runnerError = error
                  failedRunnable = runnable
                }
              })
            })
            await reported.promise
            assert.equal(failures, 2)
            assert.equal(attempts, nativeRetry ? 2 : 1)
            assert.equal(accepted, true)
            assert.ok(rawTransportError instanceof Error)
            assert.ok(
              ['ERR_WEBDRIVER_SCOPE_TIMEOUT', 'ERR_MOCHA_TIMEOUT'].includes(runnerError.code)
            )
            assert.match(runnerError.message, /Timeout/)
            if (runnerError.code === 'ERR_WEBDRIVER_SCOPE_TIMEOUT') {
              assert.equal(runnerError.name, 'WebDriverScopeTimeoutError')
            }
            assert.equal(outcomes.length, nativeRetry ? 2 : 1)
            assert.equal(outcomes.at(-1).error, runnerError)
            assert.equal(outcomes.at(-1).passed, false)
            if (nativeRetry) {
              assert.equal(outcomes[0].error, initialFailure)
              assert.notEqual(failedRunnable, first)
              assert.equal(failedRunnable.currentRetry(), 1)
            }
            assert.match(evidenceError.message, /quarantined/)
            assert.match(cleanupError.message, /quarantined/)
            assert.equal(nextRan, false)
            await assert.rejects(driver.releaseActions(), /quarantined/)
            assert.deepEqual(
              trace.filter((item) => /^(POST|GET|DELETE) /.test(item)),
              ['POST /session/deadline/actions']
            )
            assert.ok(trace.includes('onError'))
            assert.equal(trace.includes('onComplete'), false)
          } finally {
            await agent.destroy()
          }
        }
      )
    }
  } finally {
    setGlobalDispatcher(previous)
  }
})
