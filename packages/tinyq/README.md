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

Subpath exports: `@qkitt/tinyq/queue`, `@qkitt/tinyq/router`, `@qkitt/tinyq/worker`, `@qkitt/tinyq/events`.

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

### Topic routing

`buildTopicRouter` fans a published dotted topic out to queue-like `enqueue`
targets. Patterns are exact, `*` (one segment), or trailing `#` (zero or more).

```ts
import { buildQueue, buildTopicRouter, type TopicMessage } from '@qkitt/tinyq'

const orders = buildQueue<TopicMessage<{ id: string }>>()
const audit = buildQueue<TopicMessage>()
const topics = buildTopicRouter()

topics.bind('orders.created', orders)
topics.bind('orders.#', audit)
topics.publish('orders.created', { id: 'o_1' })
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
| Topic fan-out | `buildTopicRouter()` → `bind(pattern, queue)` → `publish(topic, data)` |

Runnable scenarios: [examples/](https://github.com/eugene-p/tinyq/tree/main/examples) in the monorepo.

## API

Full options, events, and errors: **[API.md](./API.md)** (also on [GitHub](https://github.com/eugene-p/tinyq/blob/main/packages/tinyq/API.md)).

Composition: `buildQueue` → `withWorker` → `withLoop` / `withDlq`. Pass `retryWorker` / `pipelineWorker` as the worker function.

## Benchmarks

Worker drain leads in-process peers (async.queue, fastq, p-queue) on jobs/s and retained heap; bare FIFO trails denque / yocto-queue on pure enq/deq.

Re-run from the monorepo: `npm run bench` · harness: [`@qkitt/tinyq-bench`](https://github.com/eugene-p/tinyq/tree/main/packages/bench).

## License

[ISC](./LICENSE)
