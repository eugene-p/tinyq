import {
  makePayloads,
  printHeader,
  WORKER_PAYLOAD_BYTES,
  WORKER_PAYLOAD_CONCURRENCIES,
  WORKER_PAYLOAD_JOB_COUNTS,
} from './helpers.js'
import { runPayloadDrainMatrix } from './worker-payload-shared.js'

/** 3) workers payload, discard — 1 KiB jobs, body ignores item */

const discard = (_item: Uint8Array): void => {}

export const runWorkerPayloadBench = async (): Promise<void> => {
  const maxN = Math.max(...WORKER_PAYLOAD_JOB_COUNTS)
  const pool = makePayloads(maxN, WORKER_PAYLOAD_BYTES)

  for (const jobCount of WORKER_PAYLOAD_JOB_COUNTS) {
    const jobs = pool.slice(0, jobCount)
    for (const concurrency of WORKER_PAYLOAD_CONCURRENCIES) {
      printHeader(
        `3) workers payload discard — ${jobCount.toLocaleString()} × ${WORKER_PAYLOAD_BYTES} B, c=${concurrency}`,
      )

      await runPayloadDrainMatrix({
        jobs,
        concurrency,
        jobCount,
        body: discard,
        label: 'payload-discard',
        memoryPayloadBytes: WORKER_PAYLOAD_BYTES,
      })
    }
  }
}
