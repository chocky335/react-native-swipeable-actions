import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const React = require('react')
const { act, create } = require('react-test-renderer')

// Evaluate the shipped jestSetup.js as a consumer's Jest would, with only the
// jest.mock/jest.fn surface it uses and a host View in place of react-native.
function loadShippedMock() {
  let factory
  const fn = (implementation) => {
    let value
    const mock = (...args) => (implementation ? implementation(...args) : value)
    mock.mockReturnValue = (next) => {
      value = next
      return mock
    }
    return mock
  }
  const jest = { mock: (_path, moduleFactory) => { factory = moduleFactory }, fn }
  const modules = { react: React, 'react-native': { View: 'View' } }
  const source = readFileSync(new URL('../jestSetup.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, { jest, require: (name) => modules[name] })
  return factory()
}

// Consumer lifecycle callbacks reach Swipeable only through these native event props.
const lifecycleProps = ['onSwipeStart', 'onSwipeStateChange', 'onSwipeEnd', 'onSwipeProgress', 'onGestureCancelled']

for (const recyclingKey of [undefined, 'row']) {
  test(`shipped Jest mock mounts action rails without a swipe lifecycle (recyclingKey=${recyclingKey})`, () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { SwipeableView } = loadShippedMock()
    const received = []
    // Swipeable's handlers read nativeEvent metadata, like the native views send it.
    const props = {
      ...(recyclingKey ? { recyclingKey } : {}),
      onActionsNeeded: (event) => received.push(['actions', event.nativeEvent.side, event.nativeEvent.recyclingKey]),
      ...Object.fromEntries(lifecycleProps.map((name) => [name, () => received.push([name])]))
    }
    let tree
    act(() => {
      tree = create(React.createElement(SwipeableView, props))
    })
    assert.deepEqual(received, [
      ['actions', 'left', recyclingKey],
      ['actions', 'right', recyclingKey]
    ])
    // Tests fire native-shaped events through the host View props.
    const host = tree.root.findByType('View')
    for (const name of lifecycleProps) assert.equal(host.props[name], props[name], name)
    assert.equal(host.props.onActionsNeeded, undefined)
    act(() => tree.unmount())
    assert.equal(received.length, 2, 'Mount and unmount must not call a lifecycle callback')
  })
}
