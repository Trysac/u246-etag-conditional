# Implement RFC 9110 conditional request logic as pure functions

Status: accepted (generated, pending human review)

## Context

APIs need to correctly handle ETags and conditional headers (If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since) to support caching, validation, and optimistic concurrency. Many frameworks implement only partial rules or use string equality, leading to incorrect 304/412 decisions.

## Decision

Provide a TypeScript library with pure functions: computeEtag, parseEntityTags, evaluatePreconditions, formatHttpDate, parseHttpDate, notModifiedHeaders, and a typed EtagError. The implementation follows RFC 9110 sections 5.6.7, 8.8.3, and 13.2.2 exactly, including strong vs weak comparison, method-specific behavior, and date handling with second precision.

## Consequences

The library is framework-agnostic, has no runtime dependencies, and is easily testable. Consumers can integrate it with Node.js HTTP, Express, or other frameworks by calling the functions directly. The design prioritizes correctness over convenience, leaving framework-specific adapters to the user.
