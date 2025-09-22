import { Command } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { FileSystem } from '@effect/platform/FileSystem'
import { Fs, FsLoc, Lang, type PackageManager } from '@wollybeard/kit'
import * as FsLocOps from '@wollybeard/kit/fs-loc'
import { Effect, Option, pipe } from 'effect'
import { Layout } from './lib/layout/index.js'

// Aliases for FsLoc decode functions
const rf = FsLoc.RelFile.decodeSync // relative file
const rd = FsLoc.RelDir.decodeSync // relative directory
const af = FsLoc.AbsFile.decodeSync // absolute file
const ad = FsLoc.AbsDir.decodeSync // absolute directory

type ScriptRunner = (...args: any[]) => Effect.Effect<any>

type ScriptRunners = Record<string, ScriptRunner>

/** Project instance with file operations and script runners */
export interface Projector<
  $ScriptRunners extends ScriptRunners = {},
> {
  /** File system layout operations */
  layout: Layout.Layout
  /** Execute shell commands in project directory */
  shell: (command: string) => Effect.Effect<string, Error>
  /** Execute package manager commands */
  packageManager: (command: string) => Effect.Effect<string, Error>
  /** Parsed project files */
  files: {
    /** Parsed package.json if present */
    packageJson: Option.Option<any>
  }
  /** Custom script runners */
  run: $ScriptRunners
  /** Project root directory */
  dir: FsLoc.AbsDir.AbsDir
}

type ScaffoldInput = TemplateScaffoldInput | InitScaffold

interface TemplateScaffoldInput {
  type: `template`
  dir: string | FsLoc.AbsDir.AbsDir
  // TODO: Add ignore patterns once Fs.copy supports filtering
  // ignore?: Str.PatternsInput
}

interface InitScaffold {
  type: `init`
}

interface TemplateScaffold {
  type: `template`
  dir: FsLoc.AbsDir.AbsDir
  // TODO: Add ignore patterns once Fs.copy supports filtering
  // ignore: Str.PatternsInput
}

type Scaffold = TemplateScaffold | InitScaffold

interface ConfigInput<$ScriptRunners extends ScriptRunners = ScriptRunners> {
  directory?: string | FsLoc.AbsDir.AbsDir | undefined
  package?: false | {
    install?: boolean | undefined
    links?: {
      dir: string | FsLoc.AbsDir.AbsDir
      protocol: PackageManager.LinkProtocol
    }[] | undefined
  }
  scripts?: ((project: Projector) => $ScriptRunners) | undefined
  scaffold?: string | FsLoc.AbsDir.AbsDir | ScaffoldInput | undefined
}

interface Config {
  directory: FsLoc.AbsDir.AbsDir
  scaffold: Scaffold
  package: {
    enabled: boolean
    install: boolean
  }
}

const resolveConfigInput = (configInput: ConfigInput<any>): Effect.Effect<Config, Error, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem

    // Decode scaffold input
    const scaffold: Scaffold = yield* (() => {
      if (!configInput.scaffold) {
        return Effect.succeed({ type: `init` } satisfies InitScaffold)
      }

      if (typeof configInput.scaffold === `string`) {
        // String always means template directory
        return FsLoc.AbsDir.decode(configInput.scaffold).pipe(
          Effect.map(dir => ({ type: `template`, dir } satisfies TemplateScaffold)),
          Effect.mapError(() => new Error(`Invalid scaffold directory: ${configInput.scaffold}`)),
        )
      }

      if ('_tag' in configInput.scaffold) {
        // Already a FsLoc directory
        return Effect.succeed(
          {
            type: `template`,
            dir: configInput.scaffold as FsLoc.AbsDir.AbsDir,
          } satisfies TemplateScaffold,
        )
      }

      // Must be ScaffoldInput
      if (configInput.scaffold.type === `template`) {
        const dirInput = configInput.scaffold.dir
        return typeof dirInput === 'string'
          ? FsLoc.AbsDir.decode(dirInput).pipe(
            Effect.mapError(() => new Error(`Invalid template directory: ${dirInput}`)),
            Effect.map(dir => ({ type: `template` as const, dir })),
          )
          : Effect.succeed({ type: `template` as const, dir: dirInput as FsLoc.AbsDir.AbsDir })
      }

      return Effect.succeed({ type: `init` } satisfies InitScaffold)
    })()

    const install = configInput.package ? (configInput.package.install ?? false) : false

    // Decode or create directory
    const directory = yield* (() => {
      if (configInput.directory) {
        if (typeof configInput.directory === 'string') {
          return FsLoc.AbsDir.decode(configInput.directory).pipe(
            Effect.mapError(() => new Error(`Invalid directory: ${configInput.directory}`)),
          )
        } else {
          return Effect.succeed(configInput.directory)
        }
      } else {
        // Create a temp directory
        return Effect.gen(function*() {
          const tempDirPath = `/tmp/projector-${Date.now()}/`
          const dir = yield* FsLoc.AbsDir.decode(tempDirPath).pipe(
            Effect.mapError(() => new Error(`Invalid temp directory: ${tempDirPath}`)),
          )
          yield* fs.makeDirectory(FsLoc.encodeSync(dir), { recursive: true }).pipe(
            Effect.mapError(error => new Error(`Failed to create temp directory: ${error}`)),
          )
          return dir
        })
      }
    })()

    return {
      directory,
      scaffold,
      package: {
        enabled: configInput.package !== false,
        install,
      },
    }
  })

const runShellCommand = (cwd: FsLoc.AbsDir.AbsDir) => (command: string): Effect.Effect<string, Error, never> =>
  pipe(
    Command.make('sh', '-c', command),
    Command.workingDirectory(FsLoc.encodeSync(cwd)),
    Command.string,
    Effect.mapError(error => new Error(String(error))),
    Effect.provide(NodeContext.layer),
  )

const runPackageManagerCommand = (cwd: FsLoc.AbsDir.AbsDir) => (command: string): Effect.Effect<string, Error, never> =>
  runShellCommand(cwd)(`pnpm ${command}`)

/**
 * Create a new project with optional scaffolding and package management
 * @param parameters - Configuration for project creation
 * @returns Effect that yields a {@link Projector} instance
 */
export const create = <$ScriptRunners extends ScriptRunners = {}>(
  parameters: ConfigInput<$ScriptRunners>,
): Effect.Effect<Projector<$ScriptRunners>, Error, FileSystem> =>
  Effect.gen(function*() {
    const config = yield* resolveConfigInput(parameters)
    const fs = yield* FileSystem

    // Files setup
    const layout = Layout.create({ directory: config.directory, fs })

    // Scaffold
    switch (config.scaffold.type) {
      case `template`: {
        const templateScaffold = config.scaffold as TemplateScaffold
        yield* Fs.copy(templateScaffold.dir, config.directory)
        break
      }
      case `init`: {
        const packageJsonPath = FsLocOps.join(config.directory, rf('package.json'))
        yield* layout.write({
          loc: packageJsonPath,
          content: {
            name: `project`,
            packageManager: `pnpm@10.10.0`,
          },
        })
        break
      }
      default: {
        Lang.neverCase(config.scaffold)
      }
    }

    const packageJsonPath = FsLocOps.join(config.directory, rf('package.json'))
    const packageJsonExists = yield* Fs.exists(packageJsonPath)

    let packageJsonResult: any = null
    if (packageJsonExists) {
      const content = yield* Fs.readString(packageJsonPath)
      try {
        packageJsonResult = JSON.parse(content)
      } catch {
        // Invalid JSON
      }
    }

    if (config.package.enabled && !packageJsonResult) {
      return yield* Effect.fail(new Error(`packageJson missing in ${FsLoc.encodeSync(config.directory)}`))
    }

    const files = {
      packageJson: Option.fromNullable(packageJsonResult),
    }

    const shell = runShellCommand(config.directory)
    const packageManager = runPackageManagerCommand(config.directory)

    // Create project instance
    const project: Projector<$ScriptRunners> = {
      shell,
      layout,
      files,
      packageManager,
      dir: config.directory,
      run: undefined as any, // Will be set below
    }

    project.run = parameters.scripts?.(project) ?? {} as $ScriptRunners

    // Init operations

    // Handle links and workspace:* replacements
    const links = parameters.package ? parameters.package.links ?? [] : []
    const workspaceReplacements: Record<string, string> = {}

    for (const link of links) {
      const linkDir = typeof link.dir === 'string'
        ? yield* FsLoc.AbsDir.decode(link.dir).pipe(
          Effect.mapError(() => new Error(`Invalid link directory: ${link.dir}`)),
        )
        : link.dir

      // Calculate relative path from project to link
      const projectDirString = FsLoc.encodeSync(project.dir)
      const linkDirString = FsLoc.encodeSync(linkDir)
      const relativePath = linkDirString.replace(projectDirString, '').replace(/^\//, '')
      const pathToLinkDirFromProject = `../${relativePath}`

      // Check for workspace:* replacement
      const linkDirName = linkDir.path.segments[linkDir.path.segments.length - 1] || 'unknown'
      if (packageJsonResult && packageJsonResult.dependencies?.[linkDirName] === `workspace:*`) {
        workspaceReplacements[linkDirName] = `${link.protocol}:${pathToLinkDirFromProject}`
      } else {
        // Add link directly if not a workspace:* dependency
        switch (link.protocol) {
          case `link`: {
            yield* project.packageManager(`add link:${pathToLinkDirFromProject}`)
            break
          }
          case `file`: {
            yield* project.packageManager(`add file:${pathToLinkDirFromProject}`)
            break
          }
          default: {
            Lang.neverCase(link.protocol)
          }
        }
      }
    }

    // Apply workspace:* replacements if any
    if (Object.keys(workspaceReplacements).length > 0) {
      const manifestPath = FsLocOps.join(project.dir, rf('package.json'))
      const content = yield* Fs.readString(manifestPath)
      const manifest = JSON.parse(content)
      if (manifest && manifest.dependencies) {
        for (const [depName, replacement] of Object.entries(workspaceReplacements)) {
          manifest.dependencies[depName] = replacement
        }
        yield* Fs.writeString(manifestPath, JSON.stringify(manifest, null, 2))
      }
    }

    // Install dependencies
    if (config.package.install) {
      yield* project.packageManager(`install`)
    }

    return project
  }).pipe(Effect.provide(NodeContext.layer))

export * from './lib/layout/layout.js'
