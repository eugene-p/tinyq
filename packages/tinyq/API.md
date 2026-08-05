# @qkitt/tinyq API

Reference for public types, options, events, and errors. For install and quick start, see [README.md](./README.md).

Composition is outer-wraps-inner:

```text
buildQueue → withWorker → withLoop / withDlq
                 ↑
         retryWorker / pipelineWorker  (worker functions, not queue layers)
```

### `buildQueue<T>(options?)`

In-memory FIFO (amortised O(1) enq/deq). Unbounded queues use a head-indexed
array with automatic compaction; `maxSize` uses a fixed power-of-two ring buffer
(max `maxSize` is `2^31`).

```ts
const q = buildQueue<Job>({
  maxSize: 10_000,
  overflow: 'dropOldest',
  highWaterMark: 8_000,
  trackStats: true,
  name: 'jobs',
})
```

| Option | Default | Notes |
| --- | --- | --- |
| `maxSize` | unlimited | Safe integer 1…`2^31`. At capacity, behavior is controlled by `overflow`. |
| `overflow` | `'throw'` | Requires `maxSize`. `'throw'` → `QueueFullError`; `'dropOldest'` / `'dropNewest'`. |
| `highWaterMark` | — | Safe integer ≥ 0. Emits `queue:pressure` when size crosses the mark (both directions). |
| `trackStats` | `false` | When true, exposes `stats()` with integer counters. |
| `name` | — | Non-empty trimmed string. Required by `withLoop`. Read with `getQueueName(q)`. |

| Method | Description |
| --- | --- |
| `enqueue(item)` | Push to tail. Full-queue behavior depends on `overflow`. |
| `dequeue()` | Pop head, or `undefined` if empty. |
| `peek()` | Head without removing, or `undefined` if empty. |
| `tryDequeue()` | `{ value }` slot, or `undefined` if empty — safe when `T` may be nullish. |
| `tryPeek()` | Peek as slot, or `undefined` if empty. |
| `takeTo(out)` | Write head into `out.value`; returns `true` if taken. Hot path (no slot alloc). |
| `size()` / `isEmpty()` | Length / emptiness. |
| `clear()` | Drop all items; emits `queue:cleared`. |
| `replaceAll(items)` | Replace contents **without** `queue:enqueued` events. Throws if over `maxSize`. |
| `toArray()` | Head→tail snapshot. |
| `stats()` | When `trackStats`: `{ size, enqueued, dequeued, failed, completed, active }`. |
| `on` / `emit` | Typed events (see below). |

**Events** (allocated on first `on` — until then mutators stay on a branch-free bare path):

| Event | Payload |
| --- | --- |
| `queue:enqueued` | `{ item, size }` |
| `queue:dequeued` | `{ item, size }` |
| `queue:emptied` | — |
| `queue:cleared` | `{ removed }` |
| `queue:dropped` | `{ item, reason: 'oldest' \| 'newest', size }` — non-throw overflow |
| `queue:pressure` | `{ size, highWaterMark, above }` — size crossed the mark |

**Errors:** `QueueFullError`, `InvalidQueueOptionError`.

Nullish payloads are valid. Prefer `tryDequeue` / `tryPeek` / `takeTo` when `T` can be `null` or `undefined` — a bare `undefined` return cannot mean both “empty” and “payload was undefined”.

### `withWorker(queue, worker, options?)`

Drain a queue with a concurrency-capped worker. Overrides `enqueue` / `replaceAll` to pump without relying on `queue:enqueued` (keeps the hot path free of event payloads). Always call methods on the **returned** queue, not a retained bare inner reference.

```ts
const queue = withWorker(buildQueue<Job>(), async (job) => run(job), {
  concurrency: 4,
  autoStart: true, // default
  signal,          // optional AbortSignal-like; abort → stop()
  batchRepump: true, // optional; default auto when concurrency >= 4
  trackStats: true,
})
```

| Option | Default | Notes |
| --- | --- | --- |
| `concurrency` | `1` | Safe integer ≥ 1. |
| `autoStart` | `true` | When `false`, call `start()` to begin pumping. |
| `signal` | — | When aborted, stops taking new items (in-flight still finish). |
| `batchRepump` | auto (`concurrency >= 4`) | Coalesce async settle re-pumps into one microtask. |
| `trackStats` | `false` | Expose `stats()` with `completed` / `failed` / `active` (merges queue stats when present). |

| Control | Description |
| --- | --- |
| `start()` | Begin taking items. |
| `stop()` | Stop taking new items; in-flight work finishes. |
| `gracefulStop(options?)` | `stop` + wait for in-flight (+ optional `flush`). Backlog stays queued. |
| `drain(options?)` | Run until empty **and** idle (does not stop first). Prefer `timeoutMs`. After abort with remaining work, rejects with `WorkerAbortedError`. |
| `isRunning()` | Whether the pump may take work. |
| `isProcessing()` | Whether any item is in flight. |
| `activeCount()` | In-flight count. |
| `setConcurrency(n)` / `getConcurrency()` | Change concurrency at runtime. |
| `stats()` | When tracking is enabled on queue and/or worker. |

| Event | Payload |
| --- | --- |
| `worker:started` | `{ item }` |
| `worker:completed` | `{ item, result }` |
| `worker:failed` | `{ item, error }` |
| `worker:settled` | — (async item finished; no payload; used by `gracefulStop`) |
| `worker:idle` | — (empty + nothing in flight) |
| `worker:pump-error` | `{ error }` — unexpected dequeue failure; pump stops until `start()` |

Failed items are **not** re-queued. Handle with `retryWorker`, `withLoop`, `withDlq`, or a `worker:failed` listener.

`withLoop` / `withDlq` observe failures via an **internal** channel so they do not force the user `worker:failed` slow path on successful async jobs. User `worker:failed` listeners still work and still take the slow path.

The pump uses `takeTo` so nullish payloads stay valid and emptiness is structural.

**Errors:** `InvalidWorkerOptionError`.

### `whenIdle(queue, options?)`

Resolves when the worker queue is empty and nothing is in flight. Does **not** call `stop()`.

```ts
await whenIdle(queue, { timeoutMs: 10_000 })
```

Without `timeoutMs` the promise can hang forever (stopped pump with remaining items, stuck job). Prefer a budget — timeout rejects with `LifecycleTimeoutError` (does not cancel work).

### `drain(queue, options?)` / `queue.drain(options?)`

Same idle condition as `whenIdle`, named for the “keep running until empty” lifecycle. Distinct from `gracefulStop`, which stops taking new work first. On a worker queue, `drain` will `start()` if the pump is stopped (unless the worker `signal` is already aborted).

```ts
await queue.drain({ timeoutMs: 10_000 })
```

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

When the first attempt returns a non-thenable successfully, the result stays **synchronous** (no outer Promise) so the worker pump can stay on its sync path.

```ts
const run = retryWorker(async (job) => callApi(job), {
  retries: 3,                          // total attempts = retries + 1
  delay: (attempt) => attempt * 100,   // ms; or a fixed number
  shouldRetry: (err, attempt) => !(err instanceof FatalError),
  signal,                              // AbortSignal-like or (item, attempt) => signal
})
```

| Option | Notes |
| --- | --- |
| `retries` | Safe integer ≥ 0. Total attempts = `retries + 1`. |
| `delay` | `number` or `(attempt) => number` (1-based failed attempt). Finite ≥ 0. |
| `shouldRetry` | `(error, failedAttempt) => boolean`. Default: always retry. |
| `signal` | Abort whole sequence, or factory `(item, attempt) => signal` (1-based attempt index). |

**Errors:** `RetryExhaustedError` (`attempts`, `cause`), `InvalidRetryOptionError`.

### `pipelineWorker(steps)` / `pipelineDone(value)`

Compose steps into a worker function: output of step *n* is input of step *n+1*. Returns a `WorkerFn` for `withWorker`.

Fully synchronous steps return a non-thenable result so the outer worker can stay on its sync path. The first thenable step switches the remainder to async.

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

On worker failure, re-enqueue onto the **same** worker queue (fair retries: concurrency slot released between hops). Uses an internal failure channel (does not require a user `worker:failed` subscription). Requires a **named** queue: `buildQueue({ name: 'jobs' })`.

```ts
const queue = withLoop(
  withWorker(buildQueue<Job>({ name: 'jobs' }), run),
  {
    filter: (item, err, ctx) => ctx.hops <= 5,
    delay: (hops) => hops * 100,
    map: (item, err, ctx) => ({ ...item, lastError: String(err) }),
    cancelDelayedOnStop: true,
  },
)

const hops = getLoopHops(item, 'jobs') // item.__tq.loop.jobs.hops
queue.pendingDelayedCount() // items waiting on delay timers
```

| Option | Default | Notes |
| --- | --- | --- |
| `filter` | always | Skip re-enqueue when `false`. |
| `map` | identity | Remap **original** failed item; library always re-stamps `__tq`. |
| `delay` | immediate | `number` or `(hops) => number`. **In-memory only** — process exit drops pending delayed items. |
| `cancelDelayedOnStop` | `false` | When true, `stop()` clears pending delay timers (items dropped). |

Hop meta lives under `item.__tq.loop[name].hops` (`TQ_KEY === '__tq'`). Non-plain payloads become `{ value, __tq: { … } }`.

| Event | Payload |
| --- | --- |
| `loop:enqueued` | `{ item, error, loopItem }` |
| `loop:meta-override` | map changed `__tq`; library overwrote stamp |
| `loop:error` | `{ item, error, cause: LoopEnqueueError }` |

Prefer `retryWorker` for short in-call retries. Prefer `withDlq` to park failures for later drain. An always-failing worker can spin forever — cap with `filter` / hop checks.

**Errors:** `InvalidLoopOptionError`, `LoopEnqueueError`, `InvalidQueueCompositionError` (no worker layer).

### `withDlq` / `withDeadLetter(source, sink, options?)`

Park failed items on a **distinct** sink via `enqueue`. Uses the same internal failure channel as `withLoop` (does not force user `worker:failed` slow path). In-memory only — not a durable store.

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

### `buildTopicRouter(options?)`

Route dotted topics into one or more queue-like targets. This is an in-process
fan-out primitive: it only requires `target.enqueue({ topic, data })`, so a
target can be a tinyq queue or another compatible destination.

```ts
const topics = buildTopicRouter({ trackUnmatched: false })
topics.bind('orders.*', ordersQueue)
topics.bind('orders.#', auditQueue)
topics.publish('orders.created', { id: 'o_1' })
```

Patterns are exact (`orders.created`), `*` for exactly one segment
(`orders.*`), or trailing `#` for zero or more segments (`orders.#`).
`publish` returns the number of matched bindings; a failing target is reported
through `router:error` but does not prevent other matching targets receiving the message.

| Method / option | Description |
| --- | --- |
| `bind(pattern, target)` | Add a binding; returns an unbind function for it. Invalid patterns throw `InvalidTopicPatternError`. |
| `unbind(pattern, target?)` / `clear()` | Remove matching bindings / all bindings. |
| `publish(topic, data)` | Fan out `{ topic, data }`. Invalid or wildcard-containing topics throw `InvalidTopicError`. |
| `unmatchedTarget` | Optional target for publishes with no matching binding; it does not add to the matched count. |
| `trackUnmatched` | Default `true`. When `false`, skip retaining `lastUnmatched()` (count still increments). |
| `unmatchedCount()` / `lastUnmatched()` / `clearUnmatched()` | Inspect or reset unmatched-publish diagnostics. |

| Event | Payload |
| --- | --- |
| `router:bound` / `router:unbound` / `router:cleared` | Binding change details. |
| `router:published` | `{ topic, data, matched }` |
| `router:unmatched` | `{ topic, data, delivered }` |
| `router:error` | `{ operation, error, topic?, pattern? }` — bind validation or target enqueue failure. |

### Helpers

| Export | Description |
| --- | --- |
| `getQueueName(queue)` | Logical name from `buildQueue({ name })`, or `undefined`. |
| `getLoopHops(item, name)` | Hop count for queue `name`, or `undefined`. |
| `TQ_KEY` | `'__tq'` — reserved bag for hop meta. |
| `buildEventEmitter<TEvents>()` | Standalone typed emitter (`on` / `emit`). |
| `exponentialBackoff({ base, max?, jitter? })` | `DelayPolicy` with exponential growth and optional jitter. |
| `drain` / `whenIdle` / `gracefulStop` | Lifecycle helpers (also methods on worker queues where applicable). |

### `DelayPolicy`

Shared by `retryWorker` and `withLoop`:

```ts
type DelayPolicy = number | ((attempt: number) => number)
```

Must resolve to a finite number ≥ 0. Only the 1-based attempt/hop count is passed — not the error.

Build with `exponentialBackoff({ base, max, jitter })` when you want capped exponential delays.
