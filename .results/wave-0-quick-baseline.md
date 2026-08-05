# Wave 0 quick baseline

Generated 2026-08-05 on Windows with Node v26.5.0. The benchmark runner used
quick mode with three rotated passes and reports median throughput.

| Benchmark | Result |
|---|---:|
| worker + loop + DLQ, c=1: bare | 8.41M jobs/s |
| worker + loop + DLQ, c=1: composed | 8.17M jobs/s |
| worker + loop + DLQ, c=4: bare | 8.08M jobs/s |
| worker + loop + DLQ, c=4: composed | 8.02M jobs/s |
| FIFO steady, 1M cycles | 65.07M cycles/s |
| FIFO steady, retained heap delta | ~11.14 KiB |
| retry sync: bare | 25.70M jobs/s |
| retry sync: retryWorker(retries:0) | 25.68M jobs/s |
| router exact, 1 binding | 21.25M publishes/s |
| router exact, 100 bindings | 1.19M publishes/s |
| router exact, 1000 bindings | 130.0k publishes/s |

These are informational local medians; rerun on the target CI runner before
using them as a regression threshold.
