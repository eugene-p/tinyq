import {
  type BenchMode,
  isFullBenchMode,
  makePayloads,
  printHeader,
  WORKER_PAYLOAD_BYTES,
  WORKER_PAYLOAD_CONCURRENCIES,
  WORKER_PAYLOAD_JOB_COUNTS,
} from './helpers.js'
import { runPayloadDrainMatrix } from './worker-payload-shared.js'

/** 2) workers payload, discard — 1 KiB jobs, body ignores item */

const discard = (_item: Uint8Array): void => {}

export const runWorkerPayloadBench = async (mode: BenchMode): Promise<void> => {
  const jobCounts = isFullBenchMode(mode) ? WORKER_PAYLOAD_JOB_COUNTS : [5_000]
  const concurrencies = isFullBenchMode(mode) ? WORKER_PAYLOAD_CONCURRENCIES : [1]
  const maxN = Math.max(...jobCounts)
  const pool = makePayloads(maxN, WORKER_PAYLOAD_BYTES)

  for (const jobCount of jobCounts) {
    const jobs = pool.slice(0, jobCount)
    for (const concurrency of concurrencies) {
      printHeader(
        `2) workers payload discard — ${jobCount.toLocaleString()} × ${WORKER_PAYLOAD_BYTES} B, c=${concurrency}`,
      )

      await runPayloadDrainMatrix({
        jobs,
        concurrency,
        jobCount,
        body: discard,
        label: 'payload-discard',
        mode,
      })
    }
  }
}
