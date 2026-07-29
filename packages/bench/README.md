# @qkitt/tinyq-bench

Four suites only:

| # | Command | What |
| --- | --- | --- |
| 1 | `bench:fifo` | **fifo raw** — bare queue, numbers, enq/deq |
| 2 | `bench:worker` | **workers raw** — number jobs, empty body |
| 3 | `bench:worker-payload` | **workers payload discard** — 1 KiB jobs, body ignores item |
| 4 | `bench:worker-work` | **workers payload work** — 1 KiB jobs, body sums every byte |

```bash
npm run bench                 # 1→4
npm run bench:fifo            # 1
npm run bench:worker          # 2
npm run bench:worker-payload  # 3
npm run bench:worker-work     # 4
```

| Layer | Peers |
| --- | --- |
| Bare queue (1) | tinyq, denque, yocto-queue |
| Worker (2–4) | tinyq, fastq, p-queue, async.queue |

Metrics: `ops/s` + latency (fifo) or `jobs/s` + per-job latency (workers). Relative only.

Published summary: [package README](../tinyq/README.md#benchmarks) · [root README](../../README.md#benchmarks).
