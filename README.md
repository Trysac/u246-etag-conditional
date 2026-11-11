# etag-conditional

[![npm version](https://img.shields.io/npm/v/@trysac/etag-conditional.svg)](https://www.npmjs.com/package/@trysac/etag-conditional)
[![license: MIT](https://img.shields.io/npm/l/@trysac/etag-conditional.svg)](LICENSE)
[![CI](https://github.com/Trysac/u246-etag-conditional/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u246-etag-conditional/actions/workflows/ci.yml)

ETags and conditional requests for TypeScript APIs per RFC 9110: strong and weak comparison, If-Match, If-None-Match and date preconditions in the standard order, with 304 and 412 results

## Problem

APIs that return ETags but evaluate conditional headers by string equality get the details wrong: weak tags pass If-Match, If-Modified-Since is honoured next to If-None-Match, dates are compared in milliseconds against second-precision headers, and lost updates slip through PUT without a 412. Frameworks implement only part of the rules, usually for static files. This library implements the RFC 9110 precondition algorithm as a pure function that any HTTP framework can call.

## Install

```sh
npm install @trysac/etag-conditional
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies.

## Usage

```ts
import { computeEtag, evaluatePreconditions, notModifiedHeaders } from "@trysac/etag-conditional";

const body = JSON.stringify({ hello: "world" });
const etag = computeEtag(body); // e.g. '"LPJNul-wow4m6Dsqxbning"'
const lastModified = new Date("1994-11-06T08:49:37Z");

const result = evaluatePreconditions(
  { method: "GET", headers: { "if-none-match": 'W/"a", "b"' } },
  { etag: '"a"', lastModified },
);

if (result.status === 304) {
  // result.reason === "if_none_match_matched"
  const headers = notModifiedHeaders({ etag: '"a"', lastModified }, { "Cache-Control": "no-cache" });
  console.log(headers); // { ETag: '"a"', "Last-Modified": "Sun, 06 Nov 1994 08:49:37 GMT", "Cache-Control": "no-cache" }
}
```

Writes are protected the same way: a `PUT` carrying `If-Match` that does not strongly match the
current ETag evaluates to `{ status: 412, reason: "if_match_failed" }`, so lost updates never land.

### Express

```ts
import express from "express";
import { computeEtag, evaluatePreconditions, notModifiedHeaders } from "@trysac/etag-conditional";

const app = express();

app.get("/resource", (req, res) => {
  const body = JSON.stringify(resource);
  const etag = computeEtag(body);
  const current = { etag, lastModified: resourceUpdatedAt };
  const result = evaluatePreconditions({ method: req.method, headers: req.headers }, current);
  if (result.status === 304) {
    res.status(304).set(notModifiedHeaders(current, { "Cache-Control": "no-cache" })).end();
    return;
  }
  res.status(result.status).set("ETag", etag).type("application/json").send(body);
});
```

### node:http

```ts
import { createServer } from "node:http";
import { computeEtag, evaluatePreconditions, notModifiedHeaders } from "@trysac/etag-conditional";

createServer((req, res) => {
  const body = JSON.stringify(resource);
  const etag = computeEtag(body);
  const current = { etag, lastModified: resourceUpdatedAt };
  const result = evaluatePreconditions({ method: req.method ?? "GET", headers: req.headers }, current);
  if (result.status === 304) {
    res.writeHead(304, notModifiedHeaders(current)).end();
    return;
  }
  res.writeHead(result.status, { ETag: etag, "Content-Type": "application/json" }).end(body);
}).listen(3000);
```

## API

| Export | Signature | Description |
|---|---|---|
| `computeEtag` | `(body: string \| Uint8Array, opts?: { weak?: boolean }) => string` | Base64url of the first 16 bytes of the SHA-256 hash, quoted and optionally weak. `computeEtag('hello') === '"LPJNul-wow4m6Dsqxbning"'`. |
| `parseEntityTags` | `(value: string) => EntityTag[] \| "*"` | Parses a comma-separated entity-tag list per RFC 9110 §8.8.3; throws `EtagError` for malformed or oversized lists. |
| `evaluatePreconditions` | `(req: { method: string; headers: Record<string, string \| string[] \| undefined> }, current: { etag?: string; lastModified?: Date; exists?: boolean }) => { status: 200 \| 304 \| 412; reason: string; warnings: string[] }` | Runs the RFC 9110 §13.2.2 precondition algorithm in the standard order. |
| `formatHttpDate` | `(d: Date) => string` | Formats a date as an IMF-fixdate, e.g. `Sun, 06 Nov 1994 08:49:37 GMT`. |
| `parseHttpDate` | `(value: string, opts?: { now?: Date }) => Date \| null` | Parses IMF-fixdate, obsolete RFC 850 and asctime dates; returns `null` when invalid. |
| `notModifiedHeaders` | `(current: { etag?: string; lastModified?: Date }, extra?: Record<string, string>) => Record<string, string>` | Builds 304 headers: `ETag`/`Last-Modified` from `current` plus the allowed caching headers copied from `extra`. |
| `EtagError` | `class EtagError extends Error { readonly code: "malformed_etag" \| "header_too_large" \| "invalid_options" }` | Thrown for malformed entity tags, oversized headers and invalid options. |

Header names are matched case-insensitively and array header values are joined with `", "`.
Method names compare case-sensitively, as RFC 9110 requires. `Range` and `If-Range` are out of
scope, as are framework adapters and caching.

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
