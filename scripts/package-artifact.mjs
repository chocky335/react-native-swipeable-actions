import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageName = 'react-native-swipeable-actions'
const required = [
  'package.json', 'README.md', 'CHANGELOG.md',
  'docs/migration-v1.md', 'docs/support.md',
  'src/index.ts', 'build/index.d.ts', 'build/index.js',
  'build/Swipeable.types.d.ts', 'expo-module.config.json',
  'ios/react-native-swipeable-actions.podspec', 'ios/SwipeableView.swift',
  'ios/SwipeableModule.swift', 'ios/SwipePhysics.swift',
  'android/build.gradle', 'android/src/main/AndroidManifest.xml',
  'android/src/main/java/expo/modules/swipeable/SwipeableView.kt',
  'android/src/main/java/expo/modules/swipeable/SwipeableModule.kt'
]

export function validateInventory(files) {
  assert(Array.isArray(files), 'Package inventory must be an array')
  const paths = files.map((entry) => typeof entry === 'string' ? entry : entry.path)
  assert.equal(new Set(paths).size, paths.length, 'Duplicate package entry')
  for (const name of paths) {
    assert(typeof name === 'string' && !name.startsWith('/') && !name.includes('\\') &&
      !name.split('/').includes('..'), `Unsafe package path: ${name}`)
    assert(!/(^|\/)(__tests__|__mocks__|__type_tests__|Tests|node_modules|\.build|\.gradle|DerivedData|\.git)(\/|$)/.test(name),
      `Development files in package: ${name}`)
    assert(!/^(ios\/build\/|example\/|e2e\/)/.test(name), `Generated or demo file in package: ${name}`)
    assert(!/(^|\/)(\.DS_Store|\.env(?:\..*)?)$/.test(name), `Local file in package: ${name}`)
  }
  for (const name of required) assert(paths.includes(name), `Missing package file: ${name}`)
  return paths
}

export function validateIdentity(manifest, lock, artifact) {
  assert.equal(manifest.name, packageName)
  assert.equal(manifest.version, lock.version, 'Root lock version mismatch')
  assert.equal(manifest.version, lock.packages?.['']?.version, 'Lock package version mismatch')
  assert.equal(artifact.name, manifest.name, 'Packed name mismatch')
  assert.equal(artifact.version, manifest.version, 'Packed version mismatch')
  assert.equal(manifest.main, 'src/index.ts', 'Unexpected Metro entry')
  assert.equal(manifest.types, 'build/index.d.ts', 'Unexpected declaration entry')
}

export function validateAutolinking(result, platform, installedRoot, version) {
  const found = result.modules?.filter((entry) => entry.packageName === packageName) ?? []
  assert.equal(found.length, 1, `${platform}: expected exactly one native module`)
  const module = found[0]
  assert.equal(module.packageVersion, version, `${platform}: native package version mismatch`)
  if (platform === 'apple') {
    assert(module.modules?.includes('SwipeableModule'), 'Apple module class missing')
    const pod = module.pods?.find((entry) => entry.podName === packageName)
    assert(pod, 'Podspec not discovered')
    assert.equal(path.resolve(pod.podspecDir), path.join(installedRoot, 'ios'), 'Pod resolved outside installed artifact')
  } else {
    const project = module.projects?.find((entry) => entry.modules?.includes('expo.modules.swipeable.SwipeableModule'))
    assert(project, 'Android module class missing')
    assert.equal(path.resolve(project.sourceDir), path.join(installedRoot, 'android'), 'Gradle module resolved outside installed artifact')
  }
  return module
}

function json(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function writeJson(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`) }
function run(command, args, cwd = root, capture = false) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
}

export function pack(destination) {
  const output = path.resolve(destination)
  mkdirSync(output, { recursive: true })
  // Explicit preparation avoids user-level ignore-scripts settings and stale build files.
  run('npm', ['run', 'prepare'])
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], root, true))
  assert.equal(packed.length, 1)
  const artifact = packed[0]
  const manifest = json(path.join(root, 'package.json'))
  validateIdentity(manifest, json(path.join(root, 'package-lock.json')), artifact)
  validateInventory(artifact.files)
  const tarball = path.join(output, artifact.filename)
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
  assert.equal(artifact.integrity, integrity, 'Tarball integrity mismatch')
  const sourceSha = run('git', ['rev-parse', 'HEAD'], root, true).trim()
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=normal'], root, true).trim()
  const report = { ...artifact, sourceSha, cleanSource: dirty.length === 0 }
  if (process.env.CI) assert(report.cleanSource, 'CI artifact must come from a clean checkout')
  writeJson(path.join(output, 'package-artifact.json'), report)
  console.log(JSON.stringify({ tarball, sourceSha, cleanSource: report.cleanSource, version: artifact.version, integrity }))
  return report
}

export function copyConsumerSources(example, output) {
  for (const name of [
    'App.tsx', 'PerformanceHUD.tsx', 'index.ts', 'app.json', 'babel.config.js', 'tsconfig.json',
    'assets', 'components', 'contexts', 'features', 'screens', 'styles'
  ]) cpSync(path.join(example, name), path.join(output, name), { recursive: true })
  // Git does not preserve the demo's empty optional plugin directory.
  if (existsSync(path.join(example, 'plugins'))) {
    cpSync(path.join(example, 'plugins'), path.join(output, 'plugins'), { recursive: true })
  }
}

export function createConsumerDirectory(destination) {
  const requested = path.resolve(destination)
  assert(!lstatSync(requested, { throwIfNoEntry: false }), 'Refusing to reuse a consumer directory')
  const repository = realpathSync(root)
  const assertOutsideRepository = (directory) => {
    assert(!directory.startsWith(`${repository}${path.sep}`) && directory !== repository, 'Consumer must live outside the repository')
  }
  let ancestor = path.dirname(requested)
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
    ancestor = path.dirname(ancestor)
  }
  // Resolve existing aliases before creating even the first missing directory.
  // A dangling symlink fails realpath rather than being treated as absent.
  assertOutsideRepository(path.resolve(realpathSync(ancestor), path.relative(ancestor, requested)))
  mkdirSync(requested, { recursive: true })
  const output = realpathSync(requested)
  assertOutsideRepository(output)
  return output
}

export function installedConsumerPackage(output) {
  const installed = path.join(output, 'node_modules', packageName)
  assert(!lstatSync(installed).isSymbolicLink(), 'Consumer package must not be a workspace link')
  assert.equal(realpathSync(installed), installed, 'Consumer package resolved outside clean installation')
  return installed
}

export function consumer(tarballInput, destination) {
  const tarball = realpathSync(tarballInput)
  const artifact = json(path.join(path.dirname(tarball), 'package-artifact.json'))
  assert.equal(path.basename(tarball), artifact.filename, 'Unexpected tarball filename')
  assert.equal(`sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`, artifact.integrity)
  validateInventory(artifact.files)
  if (process.env.CI) {
    assert.equal(artifact.sourceSha, process.env.GITHUB_SHA, 'Artifact from a different commit')
    assert.equal(artifact.cleanSource, true, 'Artifact source was dirty')
  }
  const output = createConsumerDirectory(destination)
  const example = path.join(root, 'example')
  copyConsumerSources(example, output)
  const manifest = json(path.join(example, 'package.json'))
  const lock = json(path.join(example, 'package-lock.json'))
  manifest.dependencies[packageName] = `file:${tarball}`
  lock.packages[''].dependencies[packageName] = `file:${tarball}`
  delete lock.packages['..']
  delete lock.packages[`node_modules/${packageName}`]
  writeJson(path.join(output, 'package.json'), manifest)
  writeJson(path.join(output, 'package-lock.json'), lock)
  writeFileSync(path.join(output, 'metro.config.js'), "const { getDefaultConfig } = require('expo/metro-config')\nmodule.exports = getDefaultConfig(__dirname)\n")
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], output)
  const installed = installedConsumerPackage(output)
  const installedManifest = json(path.join(installed, 'package.json'))
  assert.equal(installedManifest.version, artifact.version)
  assert.equal(installedManifest.name, packageName)
  for (const name of required) assert(existsSync(path.join(installed, name)), `Installed file missing: ${name}`)
  writeFileSync(path.join(output, 'package-api.acceptance.tsx'), `import { Text, View } from 'react-native'
import { Swipeable, type SwipeableProps, type TwoSidedSwipeableProps, type SwipeableComponentProps } from '${packageName}'
const left: SwipeableProps = { recyclingKey: 'left', children: <View />, leftActions: <Text>Left</Text>, leftActionsWidth: 80 }
const right: SwipeableProps = { recyclingKey: 'right', children: <View />, rightActions: <Text>Right</Text>, rightActionsWidth: 120 }
const both: TwoSidedSwipeableProps = { ...left, rightActions: <Text>Right</Text>, rightActionsWidth: 120 }
const alias: SwipeableComponentProps = both
type RowProps = SwipeableProps & { rowID: string }
const row: RowProps = { ...left, rowID: 'row' }
const removedActions: SwipeableProps = { ...left,
  // @ts-expect-error Removed in v1; use leftActions or rightActions.
  actions: <Text>Old</Text>
}
const removedWidth: SwipeableProps = { ...left,
  // @ts-expect-error Removed in v1; use the matching side width.
  actionsWidth: 80
}
const removedPosition: SwipeableProps = { ...left,
  // @ts-expect-error Removed in v1; sides are explicit.
  actionsPosition: 'left'
}
export const acceptance = [<Swipeable {...left} />, <Swipeable {...right} />, <Swipeable {...alias} />, row, removedActions, removedWidth, removedPosition]
`)
  run(path.join(output, 'node_modules', '.bin', 'tsc'), ['--noEmit'], output)
  const native = {}
  for (const platform of ['apple', 'android']) {
    const resolution = JSON.parse(run(path.join(output, 'node_modules', '.bin', 'expo-modules-autolinking'), ['resolve', '--platform', platform, '--json'], output, true))
    native[platform] = validateAutolinking(resolution, platform, installed, artifact.version)
  }
  const report = { sourceSha: artifact.sourceSha, version: artifact.version, integrity: artifact.integrity, consumer: output, types: 'passed', autolinking: native }
  writeJson(path.join(output, 'consumer-acceptance.json'), report)
  console.log(JSON.stringify(report))
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second] = process.argv.slice(2)
  if (command === 'pack' && first && !second) pack(first)
  else if (command === 'consumer' && first && second) consumer(first, second)
  else throw new Error('Usage: package-artifact.mjs pack <output-directory> | consumer <tarball> <new-consumer-directory>')
}
