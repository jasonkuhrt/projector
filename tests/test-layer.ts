import { NodeContext } from '@effect/platform-node'
import { Fs, FsLoc } from '@wollybeard/kit'
import { Context, Layer } from 'effect'

/**
 * Service for providing a test directory that is automatically cleaned up
 */
export class TestDir extends Context.Tag('TestDir')<TestDir, FsLoc.AbsDir.AbsDir>() {}

/**
 * Layer that provides a scoped temporary directory for tests.
 * The directory is automatically removed when the test scope ends.
 */
export const TestDirLayer = Layer.scoped(
  TestDir,
  Fs.makeTempDirectoryScoped({ prefix: 'projector-test-' }),
)

/**
 * Combined test layer that includes:
 * - Temporary directory service (TestDir)
 * - Node.js platform context (FileSystem, etc.)
 */
export const TestLayer = TestDirLayer.pipe(
  Layer.provideMerge(NodeContext.layer),
)
