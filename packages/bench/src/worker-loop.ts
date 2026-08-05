import {
  buildQueue,
  withDlq,
  withLoop,
  withWorker,
} from '@qkitt/tinyq'
import {
  type BenchMode,
  isFullBenchMode,
  printHeader,
  printTimingTable,
  runTimingTasks,
  WORKER_RAW_CONCURRENCIES,
  WORKER_RAW_JOB_COUNTS,
} from './helpers.js'

/** 0.1) worker drain with withLoop + withDlq attached (c=1, c=4) */

const DRAIN_TIMEOUT_MS = 60_000

const drainBare = (n: number, concurrency: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (n === 0) {
      resolve()
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      finish(new Error(`worker-loop bare timed out (n=${n}, c=${concurrency})`))
    }, DRAIN_TIMEOUT_MS)

    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      q.stop()
      if (error !== undefined) reject(error)
      else resolve()
    }

    const q = withWorker(buildQueue<number>(), async () => {}, { concurrency })
    q.on('worker:idle', () => finish())
    q.on('worker:pump-error', ({ error }) => finish(error))
    for (let i = 0; i < n; i += 1) q.enqueue(i)
  })

const drainWithLoopDlq = (n: number, concurrency: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (n === 0) {
      resolve()
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      finish(
        new Error(`worker-loop composed timed out (n=${n}, c=${concurrency})`),
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

    const dlq = buildQueue<number>({ name: 'dlq' })
    // Succeeding worker: loop/dlq listen for failures but never fire — measures
    // the steady-state tax of the failure subscription on the happy path.
    const q = withDlq(
      withLoop(
        withWorker(buildQueue<number>({ name: 'jobs' }), async () => {}, {
          concurrency,
        }),
      ),
      dlq,
    )
    q.on('worker:idle', () => finish())
    q.on('worker:pump-error', ({ error }) => finish(error))
    for (let i = 0; i < n; i += 1) q.enqueue(i)
  })

export const runWorkerLoopBench = async (mode: BenchMode): Promise<void> => {
  const jobCounts = isFullBenchMode(mode) ? WORKER_RAW_JOB_COUNTS : [20_000]
  const concurrencies = WORKER_RAW_CONCURRENCIES

  for (const concurrency of concurrencies) {
    for (const jobCount of jobCounts) {
      printHeader(
        `0.1) worker+loop+dlq — async no-op × ${jobCount.toLocaleString()}, c=${concurrency}`,
      )

      const rows = await runTimingTasks(
        [
          {
            name: '@qkitt/tinyq bare withWorker',
            run: () => drainBare(jobCount, concurrency),
          },
          {
            name: '@qkitt/tinyq withLoop+withDlq',
            run: () => drainWithLoopDlq(jobCount, concurrency),
          },
        ],
        mode,
      )
      printTimingTable(rows, { jobCount })
    }
  }
}
