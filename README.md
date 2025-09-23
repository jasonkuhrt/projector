# Projector

## What

Projector is a JavaScript library for programmatically scaffolding and controlling projects. Built on [Effect](https://effect.website) for type-safe, composable operations.

## Why

- Manage fixtures for integration or end-to-end tests
- Programmatically create and control test projects
- Type-safe file system operations with automatic cleanup

## Installation

```sh
npm add @wollybeard/projector
```

## Documentation

This library is fully documented with JSDoc. Your IDE will provide inline documentation, or you can browse the exported types and functions to see comprehensive JSDoc comments.

## Usage

```typescript
import { create } from '@wollybeard/projector'
import { Effect } from 'effect'

// Create a project with minimal scaffold
const program = Effect.gen(function*() {
  const project = yield* create({
    scaffold: { type: 'init' },
  })

  // Write files using layout
  yield* project.layout.write({
    loc: 'src/index.js',
    content: 'console.log("hello")',
  })

  // Run shell commands
  const output = yield* project.shell('npm test')

  // Access project info
  console.log(project.dir) // FsLoc.AbsDir
  console.log(project.files.packageJson) // Option<any>
})

// Create from template directory
const fromTemplate = Effect.gen(function*() {
  const project = yield* create({
    scaffold: {
      type: 'template',
      dir: '/path/to/template',
    },
    directory: '/tmp/my-project', // Optional, auto-creates temp dir if omitted
    package: {
      install: true, // Run npm/pnpm install
      links: [{
        dir: '/path/to/local/package',
        protocol: 'link',
      }],
    },
  })

  // Use custom scripts
  yield* project.run.build()
})
```

## API

All exported types and functions include comprehensive JSDoc documentation. Key exports:

- `create(config)` - Create a new project instance
- `Projector` interface - Project instance with file and shell operations
- `Layout` - File system operations for writing multiple files
- Error classes: `InvalidDirectoryError`, `PackageJsonMissingError`, `FileSystemError`

## Requirements

- Node.js 18+
- Effect library (peer dependency)
