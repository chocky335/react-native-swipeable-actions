import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Mocha compiles a `grep` string as a regular expression, and `/source/flags` as a
 * literal. Escape each special character so that the filter matches its text only.
 */
export function literalGrep(text) {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Expected: <test title text>')
    process.exitCode = 1
  } else {
    console.log(literalGrep(process.argv[2]))
  }
}
