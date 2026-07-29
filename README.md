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

Full API, options, events, and errors: [`packages/tinyq/README.md`](./packages/tinyq/README.md#api).

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
| [`@qkitt/tinyq`](./packages/tinyq/README.md) | Install, quick start, recipes, **API**, benchmarks |
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

Four suites only. Details and setup: [`packages/bench`](./packages/bench) · re-run: `npm run bench` · full tables also in the [package README](./packages/tinyq/README.md#benchmarks).

> Node v26.5.0 · Windows · `tinybench` via `tsx --expose-gc` · 2026-07-29 · median · YMMV

**Worker drain is the strength.** Bare FIFO trails dedicated structures (denque / yocto-queue) on pure enq/deq; with a real worker body, tinyq leads peers on jobs/s.

### 1) fifo raw — 200 000 numbers enq + deq

| Library | ops/s | latency |
| --- | ---: | ---: |
| **@qkitt/tinyq** `buildQueue` | 362 | 2.77 ms |
| denque | 572 | 1.75 ms |
| yocto-queue | 548 | 1.83 ms |

### 2) workers raw — empty body (jobs/s)

| Library | 1k c=1 | 1k c=4 | 10k c=1 | 10k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **10.94M** | **11.39M** | **11.91M** | **12.47M** |
| fastq | 4.21M | 4.12M | 3.02M | 2.91M |
| async.queue | 4.00M | 4.42M | 3.96M | 4.48M |
| p-queue | 1.45M | 1.45M | 998k | 1.00M |

### 3) workers payload discard — 1 KiB jobs, body ignores item (jobs/s)

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **10.96M** | **11.26M** | **10.62M** | **10.65M** |
| async.queue | 3.70M | 3.86M | 3.03M | 3.12M |
| fastq | 3.46M | 3.44M | 1.28M | 1.30M |
| p-queue | 1.13M | 1.10M | 347k | 353k |

### 4) workers payload work — 1 KiB jobs, sum every byte (jobs/s)

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **1.55M** | **1.56M** | **1.52M** | **1.56M** |
| async.queue | 1.19M | 1.23M | 1.12M | 1.16M |
| fastq | 1.24M | 1.15M | 772k | 747k |
| p-queue | 676k | 677k | 291k | 289k |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, code style, and PR expectations. For usage questions, prefer [GitHub Discussions](https://github.com/eugene-p/tinyq/discussions).

## License

[ISC](./LICENSE)
