import { buildQueue, withWorker } from '@qkitt/tinyq'
import { queue as asyncQueue } from 'async'
import fastq from 'fastq'
import PQueue from 'p-queue'
import { Bench } from 'tinybench'
import {
  printHeader,
  printTimingTable,
  WORKER_RAW_CONCURRENCIES,
  WORKER_RAW_JOB_COUNTS,
  WORKER_RAW_MEM_JOBS,
} from './helpers.js'
import { measureAllIsolated } from './mem/spawn.js'

/** 2) workers raw — number jobs, empty body */

const DRAIN_TIMEOUT_MS = 60_000

const drainQkitt = (n: number, concurrency: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (n === 0) {
      resolve()
      return
    }
    let finished = 0
    let settled = false
    const timer = setTimeout(() => {
      finish(
        new Error(
          `worker-raw timed out (n=${n}, c=${concurrency}, finished=${finished})`,
        ),
      )
    }, DRAIN_TIMEOUT_MS)

    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      q.stop()
      if (error !== undefined) reject(error)
      else resolve()
    }

    const q = withWorker(
      buildQueue<number>(),
      async () => {
        finished += 1
        if (finished === n) finish()
      },
      { concurrency },
    )
    q.on('worker:pump-error', ({ error }) => finish(error))
    for (let i = 0; i < n; i++) q.enqueue(i)
  })

const drainFastq = async (n: number, concurrency: number): Promise<void> => {
  const q = fastq.promise(async () => {}, concurrency)
  const tasks: Promise<unknown>[] = []
  for (let i = 0; i < n; i++) tasks.push(q.push(i))
  await Promise.all(tasks)
}

const drainPQueue = async (n: number, concurrency: number): Promise<void> => {
  const q = new PQueue({ concurrency })
  const tasks: Promise<void>[] = []
  for (let i = 0; i < n; i++) {
    tasks.push(q.add(async () => {}))
  }
  await Promise.all(tasks)
}

const drainAsyncQueue = (n: number, concurrency: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (n === 0) {
      resolve()
      return
    }
    let remaining = n
    const q = asyncQueue((_task: number, cb) => {
      queueMicrotask(() => cb())
    }, concurrency)
    q.error((err) => {
      if (err) reject(err)
    })
    for (let i = 0; i < n; i++) {
      q.push(i, (err) => {
        if (err) {
          reject(err)
          return
        }
        remaining -= 1
        if (remaining === 0) resolve()
      })
    }
  })

export const runWorkerRawBench = async (): Promise<void> => {
  for (const concurrency of WORKER_RAW_CONCURRENCIES) {
    // One empty-job mem sample per concurrency (large N → stable marginal B/item).
    const memBase = await measureAllIsolated({
      jobs: WORKER_RAW_MEM_JOBS,
      payloadBytes: 0,
      concurrency,
    })

    for (const jobCount of WORKER_RAW_JOB_COUNTS) {
      printHeader(
        `2) workers raw — empty body × ${jobCount.toLocaleString()}, c=${concurrency}`,
      )

      const bench = new Bench({ time: 800, warmupTime: 150 })
      bench
        .add('@qkitt/tinyq withWorker', async () => {
          await drainQkitt(jobCount, concurrency)
        })
        .add('fastq', async () => {
          await drainFastq(jobCount, concurrency)
        })
        .add('p-queue', async () => {
          await drainPQueue(jobCount, concurrency)
        })
        .add('async.queue', async () => {
          await drainAsyncQueue(jobCount, concurrency)
        })

      await bench.run()

      const memory = memBase.map((row) => ({
        name: row.name,
        heapPerItem: row.heapPerItem,
        heapDelta: row.heapPerItem * jobCount,
      }))
      printTimingTable(bench, { jobCount, memory })
    }
  }
}
