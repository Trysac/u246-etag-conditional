# etag-conditional

[![npm version](https://img.shields.io/npm/v/@trysac/etag-conditional.svg)](https://www.npmjs.com/package/@trysac/etag-conditional)
[![license: MIT](https://img.shields.io/npm/l/@trysac/etag-conditional.svg)](LICENSE)
[![CI](https://github.com/Trysac/u246-etag-conditional/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u246-etag-conditional/actions/workflows/ci.yml)

ETags and conditional requests for TypeScript APIs per RFC 9110: strong and weak comparison, If-Match, If-None-Match and date preconditions in the standard order, with 304 and 412 results

## Problem

Describe in two or three sentences the concrete problem this utility solves, who hits it, and why existing
packages do not solve it well. Keep it factual; link to an issue or decision record when there is one.

## Install

```sh
npm install @trysac/etag-conditional
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations.

## Usage

```ts
import { greet } from "@trysac/etag-conditional";

// Build a greeting; surrounding whitespace is ignored.
const message = greet("  Ada ");
console.log(message); // "Hello, Ada!"

try {
  greet("   ");
} catch (error) {
  console.error((error as Error).message); // "name must not be empty"
}
```

## API

| Export | Signature | Description |
|---|---|---|
| `greet` | `(name: string) => string` | Placeholder API; replace it with the real one. |

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
