import {
  makePayloads,
  printHeader,
  WORKER_PAYLOAD_BYTES,
  WORKER_PAYLOAD_CONCURRENCIES,
  WORKER_PAYLOAD_JOB_COUNTS,
} from './helpers.js'
import { runPayloadDrainMatrix } from './worker-payload-shared.js'

/** 4) workers payload + work — 1 KiB jobs, sum every byte */

const sumBytes = (buf: Uint8Array): void => {
  let sum = 0
  for (let i = 0; i < buf.length; i += 1) {
    sum = (sum + buf[i]!) | 0
  }
  void sum
}

export const runWorkerWorkBench = async (): Promise<void> => {
  const maxN = Math.max(...WORKER_PAYLOAD_JOB_COUNTS)
  const pool = makePayloads(maxN, WORKER_PAYLOAD_BYTES)

  for (const jobCount of WORKER_PAYLOAD_JOB_COUNTS) {
    const jobs = pool.slice(0, jobCount)
    for (const concurrency of WORKER_PAYLOAD_CONCURRENCIES) {
      printHeader(
        `4) workers payload work — ${jobCount.toLocaleString()} × ${WORKER_PAYLOAD_BYTES} B sum, c=${concurrency}`,
      )

      await runPayloadDrainMatrix({
        jobs,
        concurrency,
        jobCount,
        body: sumBytes,
        label: 'payload-work',
      })
    }
  }
}
