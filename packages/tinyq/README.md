<img src="https://raw.githubusercontent.com/eugene-p/tinyq/main/assets/logo.svg" alt="tinyq" width="150" height="150">

# @qkitt/tinyq

[![CI](https://github.com/eugene-p/tinyq/actions/workflows/ci.yml/badge.svg)](https://github.com/eugene-p/tinyq/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@qkitt/tinyq.svg)](https://www.npmjs.com/package/@qkitt/tinyq)
[![License: ISC](https://img.shields.io/npm/l/@qkitt/tinyq.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@qkitt/tinyq.svg)](https://nodejs.org)

Composable **in-process, in-memory** queues for TypeScript — zero runtime dependencies.

Stack what you need: bare FIFO → concurrent worker → failure routing (loop / dead letter). Worker helpers (`retryWorker`, `pipelineWorker`) return functions you pass to `withWorker`. ESM only. Node.js 20+ and modern browsers. TypeScript **5+**.

**Out of scope:** multi-process / multi-machine work; durable or persisted queues.

**Versioning:** pre-1.0 — SemVer; on `0.x`, breaking changes ship in minor bumps (`0.1` → `0.2`).

## Install

```bash
npm install @qkitt/tinyq
```

```ts
import {
  buildQueue,
  withWorker,
  whenIdle,
  gracefulStop,
  retryWorker,
  pipelineWorker,
  pipelineDone,
  withLoop,
  withDlq,
  getLoopHops,
  getQueueName,
} from '@qkitt/tinyq'
```

Subpath exports: `@qkitt/tinyq/queue`, `@qkitt/tinyq/worker`, `@qkitt/tinyq/events`.

## Quick start

### Concurrent drain

```ts
import { buildQueue, withWorker, whenIdle } from '@qkitt/tinyq'

type Job = { id: string }

const queue = withWorker(
  buildQueue<Job>(),
  async (job) => {
    await handle(job)
  },
  { concurrency: 4 },
)

queue.enqueue({ id: '1' })
queue.enqueue({ id: '2' })

await whenIdle(queue, { timeoutMs: 30_000 })
```

Failed items are **not** re-queued. Use `retryWorker` for in-call retries, `withLoop` for fair same-queue re-entry (hop meta on `__tq`), or `withDlq` to park failures on a sink you drain later.

### Retries + pipeline

```ts
import {
  buildQueue,
  withWorker,
  retryWorker,
  pipelineWorker,
  pipelineDone,
} from '@qkitt/tinyq'

const run = retryWorker(
  pipelineWorker([
    async (job) => {
      if (await alreadyDone(job.id)) {
        return pipelineDone({ skipped: true })
      }
      return job
    },
    async (job) => deliver(job),
  ]),
  { retries: 3, delay: (attempt) => attempt * 100 },
)

const queue = withWorker(buildQueue<Job>(), run, { concurrency: 4 })
```

### Failure routing

```ts
import {
  buildQueue,
  withWorker,
  withLoop,
  withDlq,
  getLoopHops,
} from '@qkitt/tinyq'

const failed = buildQueue<Job>({ name: 'failed' })

const queue = withDlq(
  withLoop(
    withWorker(
      buildQueue<Job>({ name: 'jobs' }),
      async (job) => process(job),
      { concurrency: 2 },
    ),
    {
      // hop 1–2: re-enter same queue; then let DLQ take over
      filter: (item) => (getLoopHops(item, 'jobs') ?? 0) < 2,
      delay: (hops) => hops * 50,
    },
  ),
  failed,
  {
    filter: (item) => (getLoopHops(item, 'jobs') ?? 0) >= 2,
  },
)
```

## Recipes

| Task | How |
| --- | --- |
| Concurrent jobs | `withWorker(buildQueue(), run, { concurrency })` |
| Wait until drained | `whenIdle(queue, { timeoutMs })` |
| Stop, keep backlog | `gracefulStop(queue, { timeoutMs })` or `queue.gracefulStop({ timeoutMs })` |
| In-call retries | `retryWorker(fn, { retries, delay })` → pass to `withWorker` |
| Multi-step body | `pipelineWorker([step1, step2])` → pass to `withWorker` |
| Same-queue re-entry | `withLoop(withWorker(...), { filter, delay, map })` — needs `name` |
| Failure sink | `withDlq(withWorker(...), sinkQueue)` |
| Hop, then sink | `withLoop` then `withDlq` with complementary `filter`s |
| Bounded backlog | `buildQueue({ maxSize })` — `enqueue` throws `QueueFullError` |

Runnable scenarios: [examples/](https://github.com/eugene-p/tinyq/tree/main/examples) in the monorepo.

---

## API

Composition is outer-wraps-inner:

```text
buildQueue → withWorker → withLoop / withDlq
                 ↑
         retryWorker / pipelineWorker  (worker functions, not queue layers)
```

### `buildQueue<T>(options?)`

In-memory FIFO (two-stack, amortised O(1) enq/deq).

```ts
const q = buildQueue<Job>({ maxSize: 10_000, name: 'jobs' })
```

| Option | Default | Notes |
| --- | --- | --- |
| `maxSize` | unlimited | Safe integer ≥ 1. `enqueue` / `replaceAll` throw `QueueFullError` when exceeded. |
| `name` | — | Non-empty trimmed string. Required by `withLoop`. Read with `getQueueName(q)`. |

| Method | Description |
| --- | --- |
| `enqueue(item)` | Push to tail. Throws `QueueFullError` when full. |
| `dequeue()` | Pop head, or `undefined` if empty. |
| `peek()` | Head without removing, or `undefined` if empty. |
| `tryDequeue()` | `{ value }` slot, or `undefined` if empty — safe when `T` may be nullish. |
| `tryPeek()` | Peek as slot, or `undefined` if empty. |
| `takeTo(out)` | Write head into `out.value`; returns `true` if taken. Hot path (no slot alloc). |
| `size()` / `isEmpty()` | Length / emptiness. |
| `clear()` | Drop all items; emits `queue:cleared`. |
| `replaceAll(items)` | Replace contents **without** `queue:enqueued` events. Throws if over `maxSize`. |
| `toArray()` | Head→tail snapshot. |
| `on` / `emit` | Typed events (see below). |

**Events** (allocated on first `on` — until then mutators stay on a branch-free bare path):

| Event | Payload |
| --- | --- |
| `queue:enqueued` | `{ item, size }` |
| `queue:dequeued` | `{ item, size }` |
| `queue:emptied` | — |
| `queue:cleared` | `{ removed }` |

**Errors:** `QueueFullError`, `InvalidQueueOptionError`.

Nullish payloads are valid. Prefer `tryDequeue` / `tryPeek` / `takeTo` when `T` can be `null` or `undefined` — a bare `undefined` return cannot mean both “empty” and “payload was undefined”.

### `withWorker(queue, worker, options?)`

Drain a queue with a concurrency-capped worker. Overrides `enqueue` / `replaceAll` to pump without relying on `queue:enqueued` (keeps the hot path free of event payloads). Always call methods on the **returned** queue, not a retained bare inner reference.

```ts
const queue = withWorker(buildQueue<Job>(), async (job) => run(job), {
  concurrency: 4,
  autoStart: true, // default
})
```

| Option | Default | Notes |
| --- | --- | --- |
| `concurrency` | `1` | Safe integer ≥ 1. |
| `autoStart` | `true` | When `false`, call `start()` to begin pumping. |

| Control | Description |
| --- | --- |
| `start()` | Begin taking items. |
| `stop()` | Stop taking new items; in-flight work finishes. |
| `gracefulStop(options?)` | `stop` + wait for in-flight (+ optional `flush`). Backlog stays queued. |
| `isRunning()` | Whether the pump may take work. |
| `isProcessing()` | Whether any item is in flight. |
| `activeCount()` | In-flight count. |

| Event | Payload |
| --- | --- |
| `worker:started` | `{ item }` |
| `worker:completed` | `{ item, result }` |
| `worker:failed` | `{ item, error }` |
| `worker:idle` | — (empty + nothing in flight) |
| `worker:pump-error` | `{ error }` — unexpected dequeue failure; pump stops until `start()` |

Failed items are **not** re-queued. Handle with `retryWorker`, `withLoop`, `withDlq`, or a `worker:failed` listener.

The pump uses `takeTo` so nullish payloads stay valid and emptiness is structural.

**Errors:** `InvalidWorkerOptionError`.

### `whenIdle(queue, options?)`

Resolves when the worker queue is empty and nothing is in flight. Does **not** call `stop()`.

```ts
await whenIdle(queue, { timeoutMs: 10_000 })
```

Without `timeoutMs` the promise can hang forever (stopped pump with remaining items, stuck job). Prefer a budget — timeout rejects with `LifecycleTimeoutError` (does not cancel work).

### `gracefulStop(queue, options?)`

Stop taking new items, wait for in-flight work, optionally `flush`. Remaining queued items stay in place (typical SIGTERM path). Also available as `queue.gracefulStop(options)` on a worker queue.

```ts
await gracefulStop(queue, { timeoutMs: 5_000, flush: true })
```

| Option | Default | Notes |
| --- | --- | --- |
| `timeoutMs` | — | Reject with `LifecycleTimeoutError` if settle exceeds budget. Does not cancel in-flight work. |
| `flush` | `false` | If true and the queue exposes `flush()`, await it after settle. |

### `retryWorker(worker, options | retries)`

Wrap a worker function for in-call retries. Returns a `WorkerFn` for `withWorker` — does **not** wrap a queue.

```ts
const run = retryWorker(async (job) => callApi(job), {
  retries: 3,                          // total attempts = retries + 1
  delay: (attempt) => attempt * 100,   // ms; or a fixed number
  shouldRetry: (err, attempt) => !(err instanceof FatalError),
})
```

| Option | Notes |
| --- | --- |
| `retries` | Safe integer ≥ 0. Total attempts = `retries + 1`. |
| `delay` | `number` or `(attempt) => number` (1-based failed attempt). Finite ≥ 0. |
| `shouldRetry` | `(error, failedAttempt) => boolean`. Default: always retry. |

**Errors:** `RetryExhaustedError` (`attempts`, `cause`), `InvalidRetryOptionError`.

### `pipelineWorker(steps)` / `pipelineDone(value)`

Compose steps into a worker function: output of step *n* is input of step *n+1*. Returns a `WorkerFn` for `withWorker`.

```ts
const run = pipelineWorker([
  async (id: string) => fetchUser(id),
  {
    name: 'save',
    metadata: { table: 'users' },
    fn: async (user, ctx) => save(user, ctx.metadata),
  },
])
```

Steps are bare functions or `{ name, fn, metadata? }`. Each receives `(input, ctx)` with `ctx: { name, index, metadata }`. Empty step arrays throw at construction. Step failures throw `PipelineStepError` (`stepName`, `stepIndex`, `metadata`, `cause`).

Return `pipelineDone(value)` from a step to finish successfully early (later steps skipped; worker resolves with `value` — not a throw, so safe under `retryWorker`).

### `withLoop(workerQueue, options?)`

On `worker:failed`, re-enqueue onto the **same** worker queue (fair retries: concurrency slot released between hops). Requires a **named** queue: `buildQueue({ name: 'jobs' })`.

```ts
const queue = withLoop(
  withWorker(buildQueue<Job>({ name: 'jobs' }), run),
  {
    filter: (item, err, ctx) => ctx.hops <= 5,
    delay: (hops) => hops * 100,
    map: (item, err, ctx) => ({ ...item, lastError: String(err) }),
  },
)

const hops = getLoopHops(item, 'jobs') // item.__tq.loop.jobs.hops
```

| Option | Default | Notes |
| --- | --- | --- |
| `filter` | always | Skip re-enqueue when `false`. |
| `map` | identity | Remap **original** failed item; library always re-stamps `__tq`. |
| `delay` | immediate | `number` or `(hops) => number`. **In-memory only** — process exit drops pending delayed items. |

Hop meta lives under `item.__tq.loop[name].hops` (`TQ_KEY === '__tq'`). Non-plain payloads become `{ value, __tq: { … } }`.

| Event | Payload |
| --- | --- |
| `loop:enqueued` | `{ item, error, loopItem }` |
| `loop:meta-override` | map changed `__tq`; library overwrote stamp |
| `loop:error` | `{ item, error, cause: LoopEnqueueError }` |

Prefer `retryWorker` for short in-call retries. Prefer `withDlq` to park failures for later drain. An always-failing worker can spin forever — cap with `filter` / hop checks.

**Errors:** `InvalidLoopOptionError`, `LoopEnqueueError`, `InvalidQueueCompositionError` (no worker layer).

### `withDlq` / `withDeadLetter(source, sink, options?)`

Park `worker:failed` items on a **distinct** sink via `enqueue`. In-memory only — not a durable store.

```ts
const failed = buildQueue<Job>()
const queue = withDlq(withWorker(buildQueue<Job>(), run), failed, {
  filter: (item, err) => err instanceof PermanentError,
  map: (item, err) => ({ ...item, reason: String(err) }),
})
```

| Option | Default | Notes |
| --- | --- | --- |
| `filter` | always | Skip sink enqueue when `false`. |
| `map` | identity | Remap before sink `enqueue`. |

Sink must not be the same reference as `source`. Apply after the worker: `withDlq(withWorker(...), sink)`.

| Event | Payload |
| --- | --- |
| `dlq:enqueued` | `{ item, error, deadLetterItem }` |
| `dlq:error` | `{ item, error, cause: DeadLetterEnqueueError }` |

Map / filter / sink `enqueue` failures emit `dlq:error` (do not rethrow). A full bounded sink is misconfiguration — size or drain it and subscribe to `dlq:error`.

**Errors:** `InvalidDeadLetterOptionError`, `DeadLetterEnqueueError`, `InvalidQueueCompositionError`.

### Helpers

| Export | Description |
| --- | --- |
| `getQueueName(queue)` | Logical name from `buildQueue({ name })`, or `undefined`. |
| `getLoopHops(item, name)` | Hop count for queue `name`, or `undefined`. |
| `TQ_KEY` | `'__tq'` — reserved bag for hop meta. |
| `buildEventEmitter<TEvents>()` | Standalone typed emitter (`on` / `emit`). |

### `DelayPolicy`

Shared by `retryWorker` and `withLoop`:

```ts
type DelayPolicy = number | ((attempt: number) => number)
```

Must resolve to a finite number ≥ 0. Only the 1-based attempt/hop count is passed — not the error.

---

## Benchmarks

Four suites only (in-process peers). Re-run from the monorepo:

```bash
npm run bench                 # 1→4
npm run bench:fifo            # 1 fifo raw
npm run bench:worker          # 2 workers raw
npm run bench:worker-payload  # 3 workers payload discard
npm run bench:worker-work     # 4 workers payload work
```

Harness: [`@qkitt/tinyq-bench`](https://github.com/eugene-p/tinyq/tree/main/packages/bench).

> Node v26.5.0 · Windows · `tinybench` via `tsx --expose-gc` · 2026-07-28 · median · YMMV

**Worker drain is the strength.** Bare FIFO is competitive but trails dedicated ring structures (denque / yocto-queue) on pure enq/deq. Suites **2** and **3** also report retained heap (`heapUsed + arrayBuffers`) per library in a separate process.

### 1) fifo raw — 200 000 numbers enq + deq

| Library | ops/s | latency |
| --- | ---: | ---: |
| **@qkitt/tinyq** `buildQueue` | 369 | 2.71 ms |
| denque | 585 | 1.71 ms |
| yocto-queue | 572 | 1.75 ms |

ops/s = full 200k-enqueue + 200k-dequeue cycles per second.

### 2) workers raw — number jobs, empty body

| Library | 1k c=1 | 1k c=4 | 10k c=1 | 10k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **10.99M** | **11.31M** | **11.77M** | **12.22M** |
| async.queue | 4.01M | 4.38M | 3.96M | 4.13M |
| fastq | 4.40M | 4.20M | 2.63M | 2.15M |
| p-queue | 1.41M | 1.45M | 1.03M | 985k |

jobs/s (higher is better). Empty async body — drain overhead only.

Retained **heap/item** (empty object jobs, ~approx):

| Library | c=1 | c=4 |
| --- | ---: | ---: |
| **@qkitt/tinyq** | **~65 B** | **~62 B** |
| async.queue | ~457 B | ~452 B |
| fastq | ~662 B | ~661 B |
| p-queue | ~772 B | ~852 B |

### 3) workers payload discard — 1 KiB jobs, body ignores item

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **10.86M** | **11.17M** | **10.61M** | **10.91M** |
| async.queue | 3.70M | 4.00M | 2.90M | 3.27M |
| fastq | 3.54M | 2.91M | 1.33M | 1.30M |
| p-queue | 1.12M | 1.09M | 343k | 347k |

Retained **heap/item** with 1 KiB payloads held (~approx, 20k c=1):

| Library | heap/item |
| --- | ---: |
| **@qkitt/tinyq** | **~1.24 KiB** |
| async.queue | ~1.59 KiB |
| fastq | ~1.81 KiB |
| p-queue | ~1.95 KiB |

### 4) workers payload work — 1 KiB jobs, sum every byte

| Library | 5k c=1 | 5k c=4 | 20k c=1 | 20k c=4 |
| --- | ---: | ---: | ---: | ---: |
| **@qkitt/tinyq** `withWorker` | **1.52M** | **1.53M** | **1.53M** | **1.53M** |
| async.queue | 1.18M | 1.20M | 1.10M | 1.14M |
| fastq | 1.19M | 1.15M | 762k | 738k |
| p-queue | 667k | 633k | 283k | 280k |

Real per-job CPU (touch every byte). Gaps shrink vs empty-body suites when the body dominates.

## License

[ISC](./LICENSE)
