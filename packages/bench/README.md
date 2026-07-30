# @qkitt/tinyq-bench

Default `npm run bench` is a compact timing suite: three rotated passes (20
timed samples after 12 warmups), representative workloads, and `async.queue`
as the worker baseline.
Use `npm run bench:full` for every peer, payload size, and concurrency cell.
Memory runs separately so process startup and GC do not affect timing.

Suites run in worker-first order:

| # | Command | What |
| --- | --- | --- |
| 1 | `bench:worker` | **workers raw** — number jobs, async no-op body |
| 2 | `bench:worker-payload` | **workers payload discard** — 1 KiB jobs, body ignores item |
| 3 | `bench:worker-work` | **workers payload work** — 1 KiB jobs, body sums every byte |
| 4 | `bench:fifo` | **fifo raw** — bare queue, numbers, enq/deq |

```bash
npm run bench                 # 1→4
npm run bench:full            # exhaustive timing matrix, all peers
npm run bench:mem             # representative retained-memory matrix
npm run bench:worker          # 1 only
npm run bench:worker-payload  # 2 only
npm run bench:worker-work     # 3 only
npm run bench:fifo            # 4 only
```

| Layer | Peers |
| --- | --- |
| Bare queue (4) | tinyq, denque, yocto-queue |
| Worker (1–3), default | tinyq, async.queue |
| Worker (1–3), `bench:full` | tinyq, fastq, p-queue, async.queue |

**Metrics**

| Suite | Timing | Memory |
| --- | --- | --- |
| 1 | `jobs/s`, latency, pass range | — |
| 2 | `jobs/s`, latency, pass range | — |
| 3 | `jobs/s`, latency, pass range | — |
| 4 | `ops/s`, latency, pass range | — |

Retained sample is `heapUsed + arrayBuffers`. `bench:mem` runs the representative raw c=1/c=4 and payload c=1 matrix; custom probes live under `src/mem/*` (`--jobs`, `--payload`, optional `--concurrency`).

```bash
npm run mem -- --jobs 20000 --payload 0
npm run mem -- --jobs 20000 --payload 1024
npm run mem:tinyq -- --jobs 10000 --payload 0
# mem:fastq · mem:p-queue · mem:async-queue
```

Timing tables show the median pass p50 plus the min–max pass range. Relative only. Published summary: [package README](../tinyq/README.md#benchmarks) · [root README](../../README.md#benchmarks).
