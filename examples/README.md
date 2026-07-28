# Examples

Runnable scripts for [`@qkitt/tinyq`](../packages/tinyq).

Requires Node.js 20+. From the monorepo root after `npm install` and `npm run build`:

```bash
npx tsx examples/worker-drain/main.ts
npx tsx examples/retry-pipeline/main.ts
npx tsx examples/with-loop/main.ts
npx tsx examples/with-dlq/main.ts
npx tsx examples/loop-and-dlq/main.ts
npx tsx examples/lifecycle/main.ts

# or all:
npm run examples
```

| Example | Task | Layers |
| --- | --- | --- |
| [`worker-drain`](./worker-drain/main.ts) | Concurrent jobs + drain wait | `buildQueue` → `withWorker` |
| [`lifecycle`](./lifecycle/main.ts) | `whenIdle` drain vs `gracefulStop` | `buildQueue` → `withWorker` |
| [`retry-pipeline`](./retry-pipeline/main.ts) | Retries / multi-step | `pipelineWorker` + `retryWorker` → `withWorker` |
| [`with-loop`](./with-loop/main.ts) | Same-queue re-entry, hop cap, hop-based `delay` | `buildQueue({ name })` → `withWorker` → `withLoop` |
| [`with-dlq`](./with-dlq/main.ts) | Failed items → distinct sink | `withWorker` → `withDeadLetter` / `withDlq` |
| [`loop-and-dlq`](./loop-and-dlq/main.ts) | Hop, then dead-letter via filters | `withWorker` → `withLoop` → `withDlq` |
