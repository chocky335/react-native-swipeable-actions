import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { literalGrep } from './test-filter.mjs'

const Mocha = createRequire(import.meta.url)('mocha')

/** The RegExp that Mocha builds from a `--mochaOpts.grep` string. */
function mochaGrep(pattern) {
  return new Mocha().grep(pattern).options.grep
}

const titles = [
  'should close rows via closeAll() after scrolling',
  'should close rows via closeAll after scrolling',
  'case 1.5 [rtl] {x} a|b ^start$ *+? back\\slash',
  '/leading/i',
  'leading'
]

const matches = (text) => titles.filter((title) => mochaGrep(literalGrep(text)).test(title))

test('a filter with regular expression characters matches its text only', () => {
  assert.equal(mochaGrep('closeAll() after').test(titles[0]), false)
  assert.deepEqual(matches('closeAll() after'), [titles[0]])
  assert.deepEqual(matches('1.5 [rtl] {x} a|b ^start$ *+? back\\slash'), [titles[2]])
  assert.deepEqual(matches('a|b'), [titles[2]])
  assert.deepEqual(matches('.'), [titles[2]])
})

test('a filter in slash form is text, not a Mocha regular expression literal', () => {
  assert.deepEqual(matches('/leading/i'), ['/leading/i'])
})

test('a plain filter keeps its contains-this-text match', () => {
  assert.equal(literalGrep('Close All button'), 'Close All button')
  assert.deepEqual(matches('rows via closeAll'), titles.slice(0, 2))
})

test('the command line prints the escaped filter', () => {
  const script = fileURLToPath(new URL('./test-filter.mjs', import.meta.url))
  assert.equal(
    execFileSync(process.execPath, [script, 'close()'], { encoding: 'utf8' }),
    'close\\(\\)\n'
  )
})
