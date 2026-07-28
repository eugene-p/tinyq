<img src="https://raw.githubusercontent.com/eugene-p/qkitt-queue/main/assets/logo.svg" alt="qkitt-tinyq" width="150" height="150">

# @qkitt/tinyq

[![CI](https://github.com/eugene-p/qkitt-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/eugene-p/qkitt-queue/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@qkitt/tinyq.svg)](https://www.npmjs.com/package/@qkitt/tinyq)
[![License: ISC](https://img.shields.io/npm/l/@qkitt/tinyq.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@qkitt/tinyq.svg)](https://nodejs.org)

Composable **in-process, in-memory** queues for TypeScript — zero runtime dependencies.

Layers you can stack: bare queue (FIFO), concurrent worker, failure routing (loop / dead letter). Worker helpers (`retryWorker`, `pipelineWorker`) return functions you pass to `withWorker`. ESM only. Runs in Node.js 20+ and modern browsers. Requires TypeScript **4.7+** with `moduleResolution` `node16` or `nodenext`, or **5.0+** with `bundler`.

**Out of scope:** work that spans machines or processes; durable / persisted queues; topic routers.

**Versioning:** pre-1.0 — SemVer; on `0.x`, breaking changes ship in minor bumps (`0.1` → `0.2`).

## Install

```bash
npm install @qkitt/tinyq
```

```ts
import {
  buildQueue,
  withWorker,
  pipelineWorker,
  retryWorker,
  withLoop,
  withDlq,
} from '@qkitt/tinyq'
```

Subpath exports: `@qkitt/tinyq/queue`, `/worker`, `/events`.

## Quick start

Minimal concurrent drain:

```ts
import { buildQueue, withWorker } from '@qkitt/tinyq'

type Job = { id: string }

const queue = withWorker(
  buildQueue<Job>(),
  async (job) => {
    // handle job
  },
  { concurrency: 2 },
)

queue.enqueue({ id: '1' })
```

Retries or multi-step workers — compose a worker function, then pass it to `withWorker`:

```ts
import {
  buildQueue,
  withWorker,
  retryWorker,
  pipelineWorker,
} from '@qkitt/tinyq'

const run = retryWorker(
  pipelineWorker([validate, deliver]),
  { retries: 3, delay: 100 },
)

const queue = withWorker(buildQueue<Job>(), run, { concurrency: 4 })
```

Failed items are **not** re-queued. Use `retryWorker` for in-call retries, `withLoop` for same-queue re-entry, or `withDeadLetter` / `withDlq` for a separate sink.

## Recipes

| Task | How |
| --- | --- |
| Concurrent jobs | `withWorker(buildQueue(), run, { concurrency })` |
| Drain / graceful stop | `whenIdle(queue)` · `gracefulStop(queue)` |
| Retries / multi-step | `retryWorker` · `pipelineWorker` → pass to `withWorker` |
| Same-queue re-entry | `withLoop(withWorker(...), { filter, delay })` |
| Dead-letter sink | `withDeadLetter` / `withDlq` after the worker |
| Hop, then dead-letter | `withLoop` then `withDlq` with complementary filters |

Runnable scenarios: [examples/](https://github.com/eugene-p/qkitt-queue/tree/main/examples) in the monorepo.

## Benchmark summary

In-process peers only. Full tables and setup: [root README](https://github.com/eugene-p/qkitt-queue/blob/main/README.md#benchmarks). Re-run: [`packages/bench`](https://github.com/eugene-p/qkitt-queue/tree/main/packages/bench) (`npm run bench` from repo root).

**Strength is worker drain** (throughput + low retained backlog memory). Bare `buildQueue` is a solid FIFO with lower heap than typical peer structures; pure enqueue/dequeue ops trail denque / yocto-queue, and beat `Array#shift` by orders of magnitude.

**Worker drain** — 10 000 no-op jobs (ops/s · pending-job heap)

| Library | c=1 | c=4 | heap Δ (c=1) |
| --- | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **846** | **874** | **247 KiB** |
| fastq | 107 | 100 | 6.80 MiB |
| async.queue | 195 | 220 | 4.94 MiB |
| p-queue | 82 | 71 | 11.04 MiB |

**Bare queue** — 50 000 enqueue + dequeue (ops/s median · retained heap)

| Library | ops/s | heap Δ |
| --- | ---: | ---: |
| **@qkitt/tinyq** `buildQueue` | 789 | 1.19 MiB |
| denque | 1,462 | 1.73 MiB |
| yocto-queue | 2,161 | 1.92 MiB |
| native `Array` push/shift | 7 | 1.18 MiB |

Relative numbers (Node 22.23.1, Windows laptop, 2026-07-22). YMMV.

## License

[ISC](./LICENSE)
