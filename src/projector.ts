import { Debug, Fs, FsRelative, Language, Manifest, type PackageManager, Path, type Str } from '@wollybeard/kit'
import type { SideEffect } from '@wollybeard/kit/language'
import type { ProcessPromise, Shell } from 'zx'
import { $ } from 'zx'
import { Layout } from './lib/layout/index.js'

type ScriptRunner = (...args: any[]) => Promise<any>

type ScriptRunners = Record<string, ScriptRunner>

export const defaultTemplateIgnore = [
  /node_module/,
  /build/,
  /dist/,
]

export interface Projector<
  // eslint-disable-next-line
  $ScriptRunners extends ScriptRunners = {},
> {
  layout: Layout.Layout
  shell: Shell
  packageManager: Shell
  files: {
    packageJson?: Manifest.Manifest | undefined
  }
  run: $ScriptRunners
  /**
   * Directory path to this project.
   */
  dir: string
  /**
   * Cancel any still running child processes.
   */
  stop: () => SideEffect
}

type ScaffoldInput = TemplateScaffoldInput | InitScaffold

interface TemplateScaffoldInput {
  type: `template`
  /**
   * Path to a directory whose contents will be used as the project template.
   *
   * Its files will be copied.
   */
  dir: string
  ignore?: Str.PatternsInput
}

interface InitScaffold {
  type: `init`
}

interface TemplateScaffold {
  type: `template`
  /**
   * Path to a directory whose contents will be used as the project template.
   *
   * Its files will be copied.
   */
  dir: string
  ignore: Str.PatternsInput
}

type Scaffold = TemplateScaffold | InitScaffold

interface ConfigInput<$ScriptRunners extends ScriptRunners = ScriptRunners> {
  directory?: string | undefined
  debug?: Debug.Debug | undefined
  package?: false | {
    /**
     * @defaultValue `false`
     */
    install?: boolean | undefined
    links?: {
      dir: string
      protocol: PackageManager.LinkProtocol
    }[] | undefined
  }
  scripts?: ((project: Projector) => $ScriptRunners) | undefined
  /**
   * By default uses an "init" scaffold. This is akin to running e.g. `pnpm init`.
   */
  scaffold?: string | ScaffoldInput | undefined
}

interface Config {
  directory: string
  debug: Debug.Debug
  scaffold: Scaffold
  package: {
    enabled: boolean
    install: boolean
  }
}

const resolveConfigInput = async (configInput: ConfigInput<any>): Promise<Config> => {
  const debug = configInput.debug ?? Debug.debug

  const scaffold: Scaffold = typeof configInput.scaffold === `string`
    ? ({
      type: `template`,
      dir: configInput.scaffold,
      ignore: defaultTemplateIgnore,
    } satisfies TemplateScaffoldInput)
    : configInput.scaffold?.type === `template`
    ? {
      ...configInput.scaffold,
      ignore: configInput.scaffold.ignore ?? defaultTemplateIgnore,
    }
    : configInput.scaffold?.type === `init`
    ? ({ type: `init` } satisfies InitScaffold)
    : ({ type: `init` } satisfies InitScaffold)

  const install = configInput.package ? (configInput.package.install ?? false) : false

  const directory = configInput.directory ?? await Fs.makeTemporaryDirectory()

  return {
    directory,
    debug,
    scaffold,
    package: {
      enabled: configInput.package !== false,
      install,
    },
  }
}

// eslint-disable-next-line
export const create = async <scriptRunners extends ScriptRunners = {}>(
  parameters: ConfigInput<scriptRunners>,
): Promise<Projector<scriptRunners>> => {
  const config = await resolveConfigInput(parameters)

  const { debug } = config

  //
  //
  //
  // ━━━━━━━━━━━━━━ • Files
  //
  //

  const fsr = FsRelative.create({ directory: config.directory })
  debug(`created temporary directory`, { path: fsr.cwd })

  const layout = Layout.create({ fsRelative: fsr })

  // scaffold

  switch (config.scaffold.type) {
    case `template`: {
      await Fs.copyDir({
        from: config.scaffold.dir,
        to: fsr.cwd,
        options: { ignore: config.scaffold.ignore },
      })
      debug(`copied template`)
      break
    }
    case `init`: {
      const initPackageJson = {
        path: `package.json`,
        content: {
          name: `project`,
          packageManager: `pnpm@10.10.0`,
        },
      }
      await fsr.write(initPackageJson)
      break
    }
    default: {
      Language.neverCase(config.scaffold)
    }
  }

  const packageJson = await Manifest.resource.read(fsr.cwd)
  if (config.package.enabled) {
    if (!packageJson) Language.never(`packageJson missing in ${fsr.cwd}`)
  }

  const files = {
    packageJson,
  }

  //
  //
  //
  // ━━━━━━━━━━━━━━ • Shell
  //
  //

  // const ac = new AbortController()

  const shell = $({ cwd: fsr.cwd })

  const shellProcesses: ProcessPromise[] = []

  const shellWrapped: Shell = (pieces: any, ...args: any[]) => {
    const p = shell(pieces, ...args)
    shellProcesses.push(p)
    return p
  }

  shellWrapped.sync = shell.sync

  const pnpmShell: Shell = shellWrapped({ prefix: `pnpm ` })

  //
  //
  //
  // ━━━━━━━━━━━━━━ • Instance
  //
  //

  const project: Projector<scriptRunners> = {
    shell: shellWrapped,
    layout,
    files,
    packageManager: pnpmShell,
    dir: fsr.cwd,
    stop: async () => {
      await Promise.allSettled(shellProcesses.map(async p => {
        if (p.isHalted()) return
        await p.kill()
      }))

      // if (!ac.signal.aborted) {
      //   ac.abort('project.stop()')
      //   setTimeout(() => {
      //   }, 1000);
      // }
    },
    // Will be overwritten
    // eslint-disable-next-line
    run: undefined as any,
  }

  project.run = parameters.scripts?.(project) ?? {} as scriptRunners

  //
  //
  //
  // ━━━━━━━━━━━━━━ • Init
  //
  //

  // Replace workspace:* dependencies before any pnpm operations
  if (packageJson) {
    const links = parameters.package ? parameters.package.links ?? [] : []
    const workspaceReplacements: Record<string, string> = {}

    for (const link of links) {
      const linkDirName = Path.basename(link.dir)
      if (packageJson.dependencies?.[linkDirName] === `workspace:*`) {
        const pathToLinkDirFromProject = Path.join(
          `..`,
          Path.relative(project.layout.cwd, link.dir),
        )
        workspaceReplacements[linkDirName] = `${link.protocol}:${pathToLinkDirFromProject}`
      }
    }

    if (Object.keys(workspaceReplacements).length > 0) {
      debug(`replacing workspace:* dependencies`, workspaceReplacements)
      await Manifest.resource.update((manifest) => {
        if (manifest.dependencies) {
          for (const [depName, replacement] of Object.entries(workspaceReplacements)) {
            manifest.dependencies[depName] = replacement
          }
        }
      }, project.layout.cwd)
    }
  }

  // links (now pnpm operations should work since workspace:* is resolved)
  const links = parameters.package ? parameters.package.links ?? [] : []
  for (const link of links) {
    const pathToLinkDirFromProject = Path.join(
      `..`,
      Path.relative(project.layout.cwd, link.dir),
    )
    debug(`install link`, link)

    switch (link.protocol) {
      case `link`: {
        await project.packageManager`add ${`link:` + pathToLinkDirFromProject}`
        break
      }
      case `file`: {
        await project.packageManager`add ${`file:` + pathToLinkDirFromProject}`
        break
      }
      default: {
        Language.neverCase(link.protocol)
      }
    }
  }

  // install

  if (config.package.install) {
    await project.packageManager`install`
    debug(`installed dependencies`)
  }

  // return

  return project
}

export * from './lib/layout/layout.js'
