# Contributing to tinyq

Thanks for your interest in contributing! This document covers everything you need to get started.

## Development setup

```bash
git clone https://github.com/eugene-p/tinyq.git
cd tinyq
npm install
```

Requires Node.js >= 20 (`engines`). CI tests on Node 20, 22, 24, and 26. The repo is an npm workspaces monorepo with packages under `packages/`.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm test` | Run @qkitt/tinyq tests |
| `npm run typecheck` | Type-check @qkitt/tinyq |
| `npm run build` | Build @qkitt/tinyq |
| `npm run bench` | Run benchmarks against peer libraries |
| `npm run examples` | Run all runnable examples |
| `npm run release:check` | Full pre-release gate: typecheck + test + build + pack |

Tests live alongside source as `src/**/*.test.ts` and use Vitest with globals enabled.

## Project structure

```
packages/
  tinyq/          @qkitt/tinyq — core library (in-memory)
  bench/          @qkitt/tinyq-bench — private benchmark harness
examples/         Runnable use-case demos
```

## Code style

- ESM-only, zero runtime dependencies on core.
- Strict TypeScript (`strict: true`).
- Match existing comment style — TSDoc on public API surfaces.
- Prefer small, focused diffs. One concern per PR.
- No `any` in public API types; internal utilities may use narrow casts with a comment.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Add or update tests for any behavior change.
3. Make sure `npm run release:check` passes.
4. Keep the diff tight — avoid unrelated refactors in the same PR.
5. Write a clear PR title and description explaining the *why*.

## Reporting bugs

Use the [bug report template](https://github.com/eugene-p/tinyq/issues/new?template=bug_report.yml). Include a minimal reproduction if possible — a short snippet or a link to a StackBlitz/CodeSandbox helps enormously.

## Feature requests

Use the [feature request template](https://github.com/eugene-p/tinyq/issues/new?template=feature_request.yml). Describe the use case and the API shape you'd expect. Not every request will be accepted — the library intentionally stays small — but every request gets read.

## Questions

For "how do I…" questions, prefer [GitHub Discussions](https://github.com/eugene-p/tinyq/discussions) over issues. It keeps the issue tracker focused on actionable work and helps other users find answers.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.
