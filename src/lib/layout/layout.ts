import { FileSystem } from '@effect/platform/FileSystem'
import { Fs, FsLoc } from '@wollybeard/kit'
import * as FsLocOps from '@wollybeard/kit/fs-loc'
import { Effect } from 'effect'

/** File system layout operations for a project directory */
export interface Layout {
  /** Current working directory */
  cwd: FsLoc.AbsDir.AbsDir
  /** Write multiple files from a nested object structure */
  set: <$Layout extends Record<string, any>>($layout: $Layout) => Effect.Effect<$Layout, Error, FileSystem>
  /** Write a single file with JSON or text content */
  write: (file: { loc: FsLoc.AbsFile.AbsFile; content: any }) => Effect.Effect<void, Error, FileSystem>
}

const flattenTree = (tree: any, prefix = ''): Record<string, any> => {
  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${key}` : key

    if (typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)) {
      // Check if this object looks like file content or a directory structure
      // If it has any non-string primitive values, treat it as JSON content
      const values = Object.values(value)
      const hasNonStringPrimitives = values.some(v =>
        v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'object'
      )

      if (hasNonStringPrimitives) {
        // It has numbers, booleans, etc - treat as JSON content for a file
        result[path] = value
      } else {
        // It only has strings or nested objects - treat as directory structure
        Object.assign(result, flattenTree(value, path))
      }
    } else {
      // It's a file
      result[path] = value
    }
  }

  return result
}

/**
 * Create a layout instance for file operations within a directory
 * @param parameters.directory - Root directory for operations
 * @param parameters.fs - FileSystem service
 */
export const create = (parameters: { directory: FsLoc.AbsDir.AbsDir; fs: FileSystem }): Layout => {
  const { directory, fs } = parameters

  return {
    cwd: directory,
    set: <$Layout extends Record<string, any>>($layout: $Layout): Effect.Effect<$Layout, Error, FileSystem> =>
      Effect.gen(function*() {
        const flat = flattenTree($layout)
        const entries = Object.entries(flat)

        yield* Effect.all(
          entries.map(([filePath, content]) =>
            Effect.gen(function*() {
              const relFile = yield* FsLoc.RelFile.decode(filePath).pipe(
                Effect.mapError(() => new Error(`Invalid file path: ${filePath}`)),
              )
              const fullPath = FsLocOps.join(directory, relFile)
              // Get the parent directory by using the path segments without the file
              const parentDir: FsLoc.AbsDir.AbsDir = {
                _tag: 'LocAbsDir',
                path: fullPath.path,
              }

              // Ensure directory exists
              yield* fs.makeDirectory(FsLoc.encodeSync(parentDir), { recursive: true }).pipe(
                Effect.mapError(error => new Error(`Failed to create directory: ${error}`)),
              )

              const fileContent = typeof content === 'string'
                ? content
                : JSON.stringify(content, null, 2)

              yield* Fs.writeString(fullPath, fileContent)
            })
          ),
          { discard: true },
        )

        return $layout
      }),
    write: (file: { loc: FsLoc.AbsFile.AbsFile; content: any }) =>
      Effect.gen(function*() {
        // Get the parent directory by using the path segments without the file
        const parentDir: FsLoc.AbsDir.AbsDir = {
          _tag: 'LocAbsDir',
          path: file.loc.path,
        }

        // Ensure directory exists
        yield* fs.makeDirectory(FsLoc.encodeSync(parentDir), { recursive: true }).pipe(
          Effect.mapError(error => new Error(`Failed to create directory: ${error}`)),
        )

        const content = typeof file.content === 'string'
          ? file.content
          : JSON.stringify(file.content, null, 2)

        yield* Fs.writeString(file.loc, content)
      }),
  }
}
