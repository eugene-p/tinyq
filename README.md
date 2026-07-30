<p align="center" style="margin-bottom:0px;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/logo-dark.svg">
    <img src="./assets/logo.svg" alt="tinyq" width="150" height="150">
  </picture>
</p>

<h1 align="center" style="padding-bottom:2rem; margin-top:0px">Composable in-process queues for TypeScript</h1>

[![CI](https://github.com/eugene-p/tinyq/actions/workflows/ci.yml/badge.svg)](https://github.com/eugene-p/tinyq/actions/workflows/ci.yml)
[![npm @qkitt/tinyq](https://img.shields.io/npm/v/@qkitt/tinyq.svg?label=%40qkitt%2Ftinyq)](https://www.npmjs.com/package/@qkitt/tinyq)
[![License: ISC](https://img.shields.io/npm/l/@qkitt/tinyq.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@qkitt/tinyq.svg)](https://nodejs.org)

> **ESM-only.** This package ships ES modules exclusively. If you're in a CJS context, use a dynamic import:
> ```ts
> const { buildQueue, withWorker } = await import('@qkitt/tinyq')
> ```

| Package | What it is |
| --- | --- |
| [`@qkitt/tinyq`](./packages/tinyq) | In-memory queue, worker, retry, pipeline, loop / DLQ |
| [`@qkitt/tinyq-bench`](./packages/bench) | Benchmarks against in-process peers |

**Versioning:** pre-1.0 — SemVer; on `0.x`, breaking changes ship in minor bumps (`0.1` → `0.2`).

## When to use this

Fast **in-memory** queue toolkit. Start bare, add a layer as requirements change:

- **FIFO backlog** — hold work in order until something drains it.
- **Concurrent workers** — drain that backlog with a concurrency cap.
- **Retries** — survive flaky third-party calls (`retryWorker`).
- **Pipelines** — fixed stages per item (validate → charge → confirm).
- **Failure routing** — fair same-queue re-entry with hop meta (`withLoop`), or park failures on a sink you drain later (`withDlq`).

**Out of scope:** work that spans machines or processes; durable / persisted queues.

## Install

```bash
npm install @qkitt/tinyq
```

## Quick start

### Concurrent drain

```ts
import { buildQueue, withWorker, whenIdle } from '@qkitt/tinyq'

type Job = { id: string }

const queue = withWorker(
  buildQueue<Job>(),
  async (job) => {
    // handle job
  },
  { concurrency: 4 },
)

queue.enqueue({ id: '1' })
await whenIdle(queue, { timeoutMs: 30_000 })
```

### Retries or multi-step workers

Compose a worker function, then pass it to `withWorker`:

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

Failed items are **not** re-queued. Use `retryWorker` for in-call retries, `withDlq` to park failures on a sink you consume on your schedule, or `withLoop` for fair same-queue re-entry (hop meta on `__tq`).

Full API, options, events, and errors: [`packages/tinyq/API.md`](./packages/tinyq/API.md).

## Examples

| Example | Use case |
| --- | --- |
| [`worker-drain`](./examples/worker-drain/main.ts) | Concurrent jobs + drain wait |
| [`lifecycle`](./examples/lifecycle/main.ts) | `whenIdle` drain vs `gracefulStop` |
| [`retry-pipeline`](./examples/retry-pipeline/main.ts) | Retries / multi-step |
| [`with-loop`](./examples/with-loop/main.ts) | Same-queue re-entry, hop cap, hop-based `delay` |
| [`with-dlq`](./examples/with-dlq/main.ts) | Failed items → sink queue (drain later) |
| [`loop-and-dlq`](./examples/loop-and-dlq/main.ts) | Hop, then sink via complementary filters |

```bash
npm run build
npx tsx examples/worker-drain/main.ts
# or all: npm run examples
```

Full task index: [`examples/README.md`](./examples/README.md).

## Docs

| Link | Covers |
| --- | --- |
| [`@qkitt/tinyq`](./packages/tinyq/README.md) | Install, quick start, recipes |
| [`packages/tinyq/API.md`](./packages/tinyq/API.md) | Full API, options, events, errors |
| [`packages/bench`](./packages/bench/README.md) | Benchmark harness — how to re-run |
| [`examples/`](./examples) | Runnable use cases |

## Develop

Requires Node.js >= 20. CI runs on Node 20, 22, 24, and 26.

```bash
npm install
npm test
npm run build
npm run bench
```

## Benchmarks

`npm run bench` runs representative worker cells in three rotated passes against `async.queue`. Use `npm run bench:full` for all peers and sizes, and `npm run bench:mem` for retained memory. FIFO runs last.

Details and setup: [`packages/bench`](./packages/bench).

> Captured values: Node v26.5.0 · Windows · `tinybench` via `tsx --expose-gc` · 2026-07-30 · median · YMMV. Timing is from the full suite; retained heap is from the separate memory matrix.

**Worker drain is the strength.** Bare FIFO trails dedicated structures (denque / yocto-queue) on pure enq/deq; with a real worker body, tinyq leads peers on jobs/s and retained heap.

### 1) workers raw — async no-op (jobs/s)

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **12.08M** | **12.03M** | **10.19M** | **12.19M** |
| async.queue | 3.58M | 4.18M | 3.09M | 3.50M |
| fastq | 3.09M | 2.90M | 1.33M | 1.15M |
| p-queue | 1.03M | 1.01M | 438k | 497k |

Retained **heap/item** (empty object jobs, ~approx):

| Library | c=1 | c=4 |
| --- | ---: | ---: |
| **@qkitt/tinyq** | **~33 B** | **~47 B** |
| async.queue | ~455 B | ~456 B |
| fastq | ~660 B | ~658 B |
| p-queue | ~770 B | ~749 B |

### 2) workers payload discard — 1 KiB jobs, body ignores item (jobs/s)

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **10.25M** | **9.57M** | **11.59M** | **11.58M** |
| async.queue | 3.35M | 3.87M | 2.97M | 3.19M |
| fastq | 3.23M | 2.90M | 1.23M | 1.18M |
| p-queue | 1.02M | 1.03M | 363k | 378k |

Retained **heap/item** with 1 KiB payloads held (~approx, 20k c=1):

| Library | heap/item |
| --- | ---: |
| **@qkitt/tinyq** | **~1.21 KiB** |
| async.queue | ~1.60 KiB |
| fastq | ~1.81 KiB |
| p-queue | ~1.90 KiB |

### 3) workers payload work — 1 KiB jobs, sum every byte (jobs/s)

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **1.47M** | **1.47M** | **1.49M** | **1.48M** |
| async.queue | 1.14M | 1.18M | 1.03M | 1.09M |
| fastq | 1.11M | 1.03M | 710k | 729k |
| p-queue | 642k | 603k | 263k | 319k |

### 4) fifo raw — 200 000 numbers enq + deq

| Library | ops/s | latency |
| --- | ---: | ---: |
| **@qkitt/tinyq** `buildQueue` | 380 | 2.63 ms |
| denque | 518 | 1.93 ms |
| yocto-queue | 522 | 1.91 ms |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, code style, and PR expectations. For usage questions, prefer [GitHub Discussions](https://github.com/eugene-p/tinyq/discussions).

## License

[ISC](./LICENSE)
