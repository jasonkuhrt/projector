import { NodeContext } from '@effect/platform-node'
import { expect, it } from '@effect/vitest'
import { Fs, FsLoc } from '@wollybeard/kit'
import { Effect } from 'effect'
import { create } from '../src/projector.js'
import { TestDir, TestLayer } from './test-layer.js'

// Aliases for brevity
const rf = FsLoc.RelFile.decodeSync
const rd = FsLoc.RelDir.decodeSync
const af = FsLoc.AbsFile.decodeSync
const ad = FsLoc.AbsDir.decodeSync
const join = FsLoc.join
const writeJson = (path: FsLoc.AbsFile.AbsFile, obj: any) => Fs.writeString(path, JSON.stringify(obj, null, 2))

// Test helpers
const expectFile = function*(path: FsLoc.AbsFile.AbsFile, format?: 'json' | 'text') {
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

    expect(project.dir).toEqual(testDir)
    expect(project.files.packageJson._tag).toBe('Some')

    const pkg = yield* expectFile(join(testDir, rf('package.json')), 'json')
    expect(pkg).toMatchObject({ name: 'project', packageManager: 'pnpm@10.10.0' })
  }).pipe(Effect.provide(TestLayer)))

it.effect('create() - auto temp dir when directory omitted', () =>
  Effect.gen(function*() {
    const project = yield* create({ scaffold: { type: 'init' } })

    expect(FsLoc.encodeSync(project.dir)).toMatch(/^\/tmp\/projector-\d+\/$/)
    yield* expectFile(join(project.dir, rf('package.json')))

    // Clean up
    yield* Fs.remove(project.dir, { recursive: true })
  }).pipe(Effect.provide(NodeContext.layer)))

it.scoped('create() - template scaffold', () =>
  Effect.gen(function*() {
    const templateDir = yield* Fs.makeTempDirectoryScoped({ prefix: 'template-' })

    // Setup template
    yield* Fs.writeString(join(templateDir, rf('index.js')), 'console.log("hello from template")')
    yield* writeJson(join(templateDir, rf('package.json')), { name: 'template-project', version: '1.0.0' })
    yield* Fs.write(join(templateDir, rd('src/')), undefined, { recursive: true })
    yield* Fs.writeString(join(templateDir, rf('src/app.js')), 'export const app = () => {}')

    const testDir = yield* TestDir
    yield* create({ directory: testDir, scaffold: { type: 'template', dir: templateDir } })

    // Verify copied files
    expect(yield* expectFile(join(testDir, rf('index.js')), 'text')).toBe('console.log("hello from template")')
    yield* expectFile(join(testDir, rf('src/app.js')))
    expect(yield* expectFile(join(testDir, rf('package.json')), 'json')).toMatchObject({ name: 'template-project' })
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
    const testDir = yield* Fs.makeTempDirectory({ prefix: 'cmd-test-' })
    try {
      const project = yield* create({ directory: testDir, scaffold: { type: 'init' } })

      expect((yield* project.shell('echo "hello world"')).trim()).toBe('hello world')

      const pwd = (yield* project.shell('pwd')).trim().replace(/^\/private/, '')
      expect(pwd).toBe(FsLoc.encodeSync(testDir).slice(0, -1).replace(/^\/private/, ''))

      yield* project.shell('echo "test content" > test.txt')
      yield* expectFile(join(testDir, rf('test.txt')))
    } finally {
      yield* Fs.remove(testDir, { recursive: true })
    }
  }).pipe(Effect.provide(NodeContext.layer)))

it.scoped('#layout', () =>
  Effect.gen(function*() {
    const testDir = yield* TestDir
    const project = yield* create({ directory: testDir, scaffold: { type: 'init' } })

    // Test single file write
    yield* project.layout.write({ loc: join(testDir, rf('test.json')), content: { message: 'hello' } })
    expect(yield* expectFile(join(testDir, rf('test.json')), 'json')).toEqual({ message: 'hello' })

    // Test multi-file write
    yield* project.layout.set({
      'config.json': { type: 'config', value: 123 },
      'src': { 'index.js': 'export default "app"', 'utils.js': 'export const helper = () => {}' },
    })

    yield* expectFile(join(testDir, rf('config.json')))
    yield* expectFile(join(testDir, rf('src/index.js')))
    expect(yield* expectFile(join(testDir, rf('src/utils.js')), 'text')).toBe('export const helper = () => {}')
  }).pipe(Effect.provide(TestLayer)))
