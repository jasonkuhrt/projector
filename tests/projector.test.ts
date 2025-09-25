import { NodeContext } from '@effect/platform-node'
import { expect, it } from '@effect/vitest'
import { Fs, FsLoc } from '@wollybeard/kit'
import { Dir } from '@wollybeard/kit'
import { Effect } from 'effect'
import { create } from '../src/projector.js'
import { TestDir, TestLayer } from './test-layer.js'

// Aliases for brevity
const join = FsLoc.join

// Test helpers
const expectFile = function*(path: FsLoc.AbsFile, format?: 'json' | 'text') {
  const exists = yield* Fs.exists(path)
  expect(exists).toBe(true)
  if (format) {
    const content = yield* Fs.readString(path)
    return format === 'json' ? JSON.parse(content) : content
  }
}

it.scoped('create() - init scaffold', () =>
  Effect.gen(function*() {
    const testDir = yield* TestDir
    const project = yield* create({ directory: testDir, scaffold: { type: 'init' } })

    expect(project.dir.base).toEqual(testDir)
    expect(project.files.packageJson._tag).toBe('Some')

    const pkg = yield* expectFile(join(testDir, 'package.json'), 'json')
    expect(pkg).toMatchObject({ name: 'project', packageManager: 'pnpm@10.10.0' })
  }).pipe(Effect.provide(TestLayer)))

it.effect('create() - auto temp dir when directory omitted', () =>
  Effect.gen(function*() {
    const project = yield* create({ scaffold: { type: 'init' } })

    expect(FsLoc.encodeSync(project.dir.base)).toMatch(/^\/tmp\/projector-\d+\/$/)
    yield* expectFile(join(project.dir.base, 'package.json'))

    // Clean up
    yield* Fs.remove(project.dir.base, { recursive: true })
  }).pipe(Effect.provide(NodeContext.layer)))

it.scoped('create() - template scaffold', () =>
  Effect.gen(function*() {
    const templateDir = yield* Dir.createTemp()

    // Setup template using Dir module
    yield* Dir.withChaining(templateDir)
      .file('index.js', 'console.log("hello from template")')
      .file('package.json', { name: 'template-project', version: '1.0.0' })
      .dir('src', (_) =>
        _
          .file('app.js', 'export const app = () => {}'))
      .commit()

    const testDir = yield* TestDir
    yield* create({ directory: testDir, scaffold: { type: 'template', dir: templateDir.base } })

    // Verify copied files
    expect(yield* expectFile(join(testDir, 'index.js'), 'text')).toBe('console.log("hello from template")')
    yield* expectFile(join(testDir, 'src/app.js'))
    expect(yield* expectFile(join(testDir, 'package.json'), 'json')).toMatchObject({ name: 'template-project' })
  }).pipe(Effect.provide(TestLayer)))

it.scoped('create() - can be given custom scripts', () =>
  Effect.gen(function*() {
    const testDir = yield* TestDir
    let called = false

    const project = yield* create({
      directory: testDir,
      scaffold: { type: 'init' },
      scripts: () => ({ test: () => Effect.sync(() => (called = true, 'test script executed')) }),
    })

    expect(yield* project.run.test()).toBe('test script executed')
    expect(called).toBe(true)
  }).pipe(Effect.provide(TestLayer)))

it.effect('#shell() - runs commands in project directory', () =>
  Effect.gen(function*() {
    const tempDir = yield* Dir.createTempUnsafe()
    const testDir = tempDir.base
    try {
      const project = yield* create({ directory: testDir, scaffold: { type: 'init' } })

      expect((yield* project.shell('echo "hello world"')).trim()).toBe('hello world')

      const pwd = (yield* project.shell('pwd')).trim().replace(/^\/private/, '')
      expect(pwd).toBe(FsLoc.encodeSync(testDir).slice(0, -1).replace(/^\/private/, ''))

      yield* project.shell('echo "test content" > test.txt')
      yield* expectFile(join(testDir, 'test.txt'))
    } finally {
      yield* Fs.remove(testDir, { recursive: true })
    }
  }).pipe(Effect.provide(NodeContext.layer)))

it.scoped('#dir - chainable directory operations', () =>
  Effect.gen(function*() {
    const testDir = yield* TestDir
    const project = yield* create({ directory: testDir, scaffold: { type: 'init' } })

    // Test single file write
    yield* project.dir.file('test.json', { message: 'hello' }).commit()
    expect(yield* expectFile(join(testDir, 'test.json'), 'json')).toEqual({ message: 'hello' })

    // Test multi-file write with nested directories
    yield* project.dir
      .file('config.json', { type: 'config', value: 123 })
      .dir('src', (_: Dir.DirChain) =>
        _.file('index.js', 'export default "app"')
          .file('utils.js', 'export const helper = () => {}'))
      .commit()

    yield* expectFile(join(testDir, 'config.json'))
    yield* expectFile(join(testDir, 'src/index.js'))
    expect(yield* expectFile(join(testDir, 'src/utils.js'), 'text')).toBe('export const helper = () => {}')
  }).pipe(Effect.provide(TestLayer)))
