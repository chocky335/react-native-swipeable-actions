import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyConsumerSources, createConsumerDirectory, installedConsumerPackage, validateAutolinking, validateIdentity, validateInventory } from './package-artifact.mjs'

const files = [
  'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'docs/migration-v1.md', 'docs/support.md',
  'src/index.ts', 'build/index.d.ts', 'build/index.js', 'build/Swipeable.types.d.ts', 'expo-module.config.json',
  'ios/react-native-swipeable-actions.podspec', 'ios/SwipeableView.swift', 'ios/SwipeableModule.swift', 'ios/SwipePhysics.swift',
  'android/build.gradle', 'android/src/main/AndroidManifest.xml',
  'android/src/main/java/expo/modules/swipeable/SwipeableView.kt',
  'android/src/main/java/expo/modules/swipeable/SwipeableModule.kt'
]
test('complete public and native package inventory passes', () => {
  assert.deepEqual(validateInventory(files.map((path) => ({ path }))), files)
})
for (const entry of [
  'src/__type_tests__/migration-api.tsx', 'src/__tests__/Swipeable.test.tsx',
  'ios/build/generated/autolinking/autolinking.json', 'ios/.build/artifact',
  'ios/Tests/SwipePhysicsTests.swift', 'node_modules/react/index.js',
  'example/App.tsx', 'e2e/logs/output.json', '.env', 'ios/.DS_Store', '../private', '/private', 'ios\\private'
]) test(`rejects non-consumer entry ${entry}`, () => assert.throws(() => validateInventory([...files, entry])))
test('a missing license fails closed', () => assert.throws(() => validateInventory(files.filter((name) => name !== 'LICENSE')), /Missing package file: LICENSE/))
test('missing declarations fail closed', () => assert.throws(() => validateInventory(files.filter((name) => name !== 'build/index.d.ts'))))
test('duplicate inventory entries fail closed', () => assert.throws(() => validateInventory([...files, files[0]])))

const manifest = { name: 'react-native-swipeable-actions', version: '1.0.0-rc.0', main: 'src/index.ts', types: 'build/index.d.ts' }
const lock = { version: manifest.version, packages: { '': { version: manifest.version } } }
test('artifact, manifest and both lock versions agree', () => validateIdentity(manifest, lock, manifest))
test('root lock mismatch is rejected', () => assert.throws(() => validateIdentity(manifest, { ...lock, version: '0.1.12' }, manifest)))
test('lock package mismatch is rejected', () => assert.throws(() => validateIdentity(manifest, { ...lock, packages: { '': { version: '0.1.12' } } }, manifest)))
test('packed version mismatch is rejected', () => assert.throws(() => validateIdentity(manifest, lock, { ...manifest, version: '0.1.12' })))
test('missing declaration entry is rejected', () => assert.throws(() => validateIdentity({ ...manifest, types: undefined }, lock, manifest)))

const installed = '/tmp/consumer/node_modules/react-native-swipeable-actions'
const apple = { packageName: manifest.name, packageVersion: manifest.version, modules: ['SwipeableModule'], pods: [{ podName: manifest.name, podspecDir: `${installed}/ios` }] }
const android = { packageName: manifest.name, packageVersion: manifest.version, projects: [{ sourceDir: `${installed}/android`, modules: ['expo.modules.swipeable.SwipeableModule'] }] }
test('both native platforms resolve the installed artifact', () => {
  validateAutolinking({ modules: [apple] }, 'apple', installed, manifest.version)
  validateAutolinking({ modules: [android] }, 'android', installed, manifest.version)
})
test('missing native module fails', () => assert.throws(() => validateAutolinking({ modules: [] }, 'apple', installed, manifest.version)))
test('duplicate module fails', () => assert.throws(() => validateAutolinking({ modules: [apple, apple] }, 'apple', installed, manifest.version)))
test('workspace pod fallback fails', () => assert.throws(() => validateAutolinking({ modules: [{ ...apple, pods: [{ podName: manifest.name, podspecDir: '/repo/ios' }] }] }, 'apple', installed, manifest.version)))
test('workspace Gradle fallback fails', () => assert.throws(() => validateAutolinking({ modules: [{ ...android, projects: [{ ...android.projects[0], sourceDir: '/repo/android' }] }] }, 'android', installed, manifest.version)))
test('wrong native version fails', () => assert.throws(() => validateAutolinking({ modules: [apple] }, 'apple', installed, '1.0.0')))

function consumerFixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'swipeable-consumer-copy-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  const destination = path.join(directory, 'destination')
  mkdirSync(source)
  mkdirSync(destination)
  for (const name of ['App.tsx', 'PerformanceHUD.tsx', 'index.ts', 'app.json', 'babel.config.js', 'tsconfig.json']) {
    writeFileSync(path.join(source, name), '')
  }
  for (const name of ['assets', 'components', 'contexts', 'features', 'screens', 'styles']) {
    mkdirSync(path.join(source, name))
  }
  return { source, destination }
}

test('a fresh checkout without optional plugins copies successfully', (t) => {
  const { source, destination } = consumerFixture(t)
  copyConsumerSources(source, destination)
  assert(existsSync(path.join(destination, 'App.tsx')))
  assert(!existsSync(path.join(destination, 'plugins')))
})

test('consumer plugins are preserved when present', (t) => {
  const { source, destination } = consumerFixture(t)
  mkdirSync(path.join(source, 'plugins'))
  writeFileSync(path.join(source, 'plugins', 'with-demo.js'), 'module.exports = config => config\n')
  copyConsumerSources(source, destination)
  assert(existsSync(path.join(destination, 'plugins', 'with-demo.js')))
})

test('a missing required consumer source still fails', (t) => {
  const { source, destination } = consumerFixture(t)
  rmSync(path.join(source, 'App.tsx'))
  assert.throws(() => copyConsumerSources(source, destination), { code: 'ENOENT' })
})

function aliasedConsumer(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'swipeable-consumer-alias-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'real')
  mkdirSync(target)
  const alias = path.join(directory, 'alias')
  symlinkSync(target, alias, 'dir')
  const requested = path.join(alias, 'consumer')
  return { directory, requested, output: createConsumerDirectory(requested) }
}

test('an aliased parent resolves to a canonical clean installation', (t) => {
  const { requested, output } = aliasedConsumer(t)
  assert.equal(output, realpathSync(requested))
  assert.notEqual(output, requested)
  const installed = path.join(output, 'node_modules', manifest.name)
  mkdirSync(installed, { recursive: true })
  assert.equal(installedConsumerPackage(output), installed)
})

test('an aliased destination still refuses an existing consumer', (t) => {
  const { requested } = aliasedConsumer(t)
  assert.throws(() => createConsumerDirectory(requested), /Refusing to reuse/)
})

test('canonical consumer paths still reject package symlinks', (t) => {
  const { directory, output } = aliasedConsumer(t)
  const workspacePackage = path.join(directory, 'workspace-package')
  mkdirSync(workspacePackage)
  mkdirSync(path.join(output, 'node_modules'))
  symlinkSync(workspacePackage, path.join(output, 'node_modules', manifest.name), 'dir')
  assert.throws(() => installedConsumerPackage(output), /must not be a workspace link/)
})

test('canonical consumer paths still reject redirected node_modules', (t) => {
  const { directory, output } = aliasedConsumer(t)
  const redirected = path.join(directory, 'other-node-modules')
  mkdirSync(path.join(redirected, manifest.name), { recursive: true })
  symlinkSync(redirected, path.join(output, 'node_modules'), 'dir')
  assert.throws(() => installedConsumerPackage(output), /outside clean installation/)
})

for (const aliased of [false, true]) {
  test(`repository destination is rejected before creating parents (alias: ${aliased})`, (t) => {
    const { directory } = aliasedConsumer(t)
    const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const missing = `.rejected-${path.basename(directory)}`
    const forbidden = path.join(repository, missing)
    t.after(() => rmSync(forbidden, { recursive: true, force: true }))
    let parent = repository
    if (aliased) {
      parent = path.join(directory, 'repository-alias')
      symlinkSync(repository, parent, 'dir')
    }
    assert(!existsSync(forbidden))
    assert.throws(() => createConsumerDirectory(path.join(parent, missing, 'nested', 'consumer')), /outside the repository/)
    assert(!existsSync(forbidden), 'Rejection must not create any parent directory')
  })
}

test('external aliased destinations may have multiple missing parents', (t) => {
  const { directory } = aliasedConsumer(t)
  const requested = path.join(directory, 'alias', 'new', 'nested', 'consumer')
  const output = createConsumerDirectory(requested)
  assert.equal(output, path.join(realpathSync(directory), 'real', 'new', 'nested', 'consumer'))
  assert(existsSync(output))
})

test('dangling ancestor symlinks fail without creating their target', (t) => {
  const { directory } = aliasedConsumer(t)
  const missingTarget = path.join(directory, 'missing-target')
  const alias = path.join(directory, 'dangling')
  symlinkSync(missingTarget, alias, 'dir')
  assert.throws(() => createConsumerDirectory(path.join(alias, 'nested', 'consumer')), { code: 'ENOENT' })
  assert(!existsSync(missingTarget))
})
