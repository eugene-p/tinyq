import { buildQueue, withWorker } from '@qkitt/tinyq'
import { queue as asyncQueue } from 'async'
import fastq from 'fastq'
import PQueue from 'p-queue'
import {
  type BenchMode,
  isFullBenchMode,
  printHeader,
  printTimingTable,
  runTimingTasks,
  WORKER_RAW_CONCURRENCIES,
  WORKER_RAW_JOB_COUNTS,
} from './helpers.js'

/** 1) workers raw — number jobs, async no-op body */

const DRAIN_TIMEOUT_MS = 60_000

const drainQkitt = (n: number, concurrency: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (n === 0) {
      resolve()
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      finish(
        new Error(
          `worker-raw timed out (n=${n}, c=${concurrency})`,
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
      async () => {},
      { concurrency },
    )
    // worker:idle fires after all worker promises settle and the queue empties.
    q.on('worker:idle', () => finish())
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

export const runWorkerRawBench = async (mode: BenchMode): Promise<void> => {
  const jobCounts = isFullBenchMode(mode) ? WORKER_RAW_JOB_COUNTS : [20_000]

  for (const concurrency of WORKER_RAW_CONCURRENCIES) {
    for (const jobCount of jobCounts) {
      printHeader(
        `1) workers raw — async no-op × ${jobCount.toLocaleString()}, c=${concurrency}`,
      )

      const tasks = [
        { name: '@qkitt/tinyq withWorker', run: () => drainQkitt(jobCount, concurrency) },
        { name: 'fastq', run: () => drainFastq(jobCount, concurrency) },
        { name: 'p-queue', run: () => drainPQueue(jobCount, concurrency) },
        { name: 'async.queue', run: () => drainAsyncQueue(jobCount, concurrency) },
      ]
      const rows = await runTimingTasks(
        isFullBenchMode(mode) ? tasks : [tasks[0]!, tasks[3]!],
        mode,
      )
      printTimingTable(rows, { jobCount })
    }
  }
}
