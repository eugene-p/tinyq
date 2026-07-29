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

**Metrics**

| Suite | Timing | Memory |
| --- | --- | --- |
| 1 | `ops/s`, latency | — |
| 2 | `jobs/s`, latency | `heap Δ`, `heap/item` (empty object jobs; one process per library) |
| 3 | `jobs/s`, latency | `heap Δ`, `heap/item` (1 KiB payloads filled in-process per library) |
| 4 | `jobs/s`, latency | — |

Retained sample is `heapUsed + arrayBuffers`. Memory probes live under `src/mem/*` (`--jobs`, `--payload`, optional `--concurrency`).

```bash
npm run mem -- --jobs 20000 --payload 0
npm run mem -- --jobs 20000 --payload 1024
npm run mem:tinyq -- --jobs 10000 --payload 0
# mem:fastq · mem:p-queue · mem:async-queue
```

Relative only. Published summary: [package README](../tinyq/README.md#benchmarks) · [root README](../../README.md#benchmarks).
