import {
  buildQueue,
  retryWorker,
  type WorkerFn,
  withWorker,
} from '@qkitt/tinyq'
import {
  type BenchMode,
  printHeader,
  printTimingTable,
  runTimingTasks,
} from './helpers.js'

/** 0.3) microbench sync no-op through retryWorker vs bare worker */

const N = 50_000

const drainSync = (
  worker: WorkerFn<number, unknown>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      finish(new Error('retry-sync timed out'))
    }, 60_000)

    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      q.stop()
      if (error !== undefined) reject(error)
      else resolve()
    }

    const q = withWorker(buildQueue<number>(), worker)
    q.on('worker:idle', () => finish())
    q.on('worker:pump-error', ({ error }) => finish(error))
    for (let i = 0; i < N; i += 1) q.enqueue(i)
  })

export const runRetrySyncBench = async (mode: BenchMode): Promise<void> => {
  printHeader(
    `0.3) retry-sync — sync no-op × ${N.toLocaleString()} (bare vs retryWorker)`,
  )

  const bare = (_item: number): number => 0
  const retried = retryWorker(bare, { retries: 0 })

  const rows = await runTimingTasks(
    [
      {
        name: '@qkitt/tinyq bare sync worker',
        run: () => drainSync(bare),
      },
      {
        name: '@qkitt/tinyq retryWorker(retries:0) sync',
        run: () => drainSync(retried),
      },
    ],
    mode,
  )
  printTimingTable(rows, { jobCount: N })
}
