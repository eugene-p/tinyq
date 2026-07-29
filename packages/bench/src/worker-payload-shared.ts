import { buildQueue, withWorker } from '@qkitt/tinyq'
import { queue as asyncQueue } from 'async'
import fastq from 'fastq'
import PQueue from 'p-queue'
import { Bench } from 'tinybench'
import { printTimingTable } from './helpers.js'

const DRAIN_TIMEOUT_MS = 120_000

type Body = (item: Uint8Array) => void

const drainQkitt = (
  jobs: readonly Uint8Array[],
  concurrency: number,
  body: Body,
  label: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const n = jobs.length
    if (n === 0) {
      resolve()
      return
    }
    let finished = 0
    let settled = false
    const timer = setTimeout(() => {
      finish(
        new Error(
          `${label} timed out (n=${n}, c=${concurrency}, finished=${finished})`,
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
      buildQueue<Uint8Array>(),
      async (item) => {
        try {
          body(item)
        } finally {
          finished += 1
          if (finished === n) finish()
        }
      },
      { concurrency },
    )
    q.on('worker:pump-error', ({ error }) => finish(error))
    for (let i = 0; i < n; i += 1) q.enqueue(jobs[i]!)
  })

const drainFastq = async (
  jobs: readonly Uint8Array[],
  concurrency: number,
  body: Body,
): Promise<void> => {
  const q = fastq.promise(async (item: Uint8Array) => {
    body(item)
  }, concurrency)
  const tasks: Promise<unknown>[] = []
  for (let i = 0; i < jobs.length; i += 1) tasks.push(q.push(jobs[i]!))
  await Promise.all(tasks)
}

const drainPQueue = async (
  jobs: readonly Uint8Array[],
  concurrency: number,
  body: Body,
): Promise<void> => {
  const q = new PQueue({ concurrency })
  const tasks: Promise<void>[] = []
  for (let i = 0; i < jobs.length; i += 1) {
    const item = jobs[i]!
    tasks.push(
      q.add(async () => {
        body(item)
      }),
    )
  }
  await Promise.all(tasks)
}

const drainAsyncQueue = (
  jobs: readonly Uint8Array[],
  concurrency: number,
  body: Body,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const n = jobs.length
    if (n === 0) {
      resolve()
      return
    }
    let remaining = n
    const q = asyncQueue((item: Uint8Array, cb) => {
      queueMicrotask(() => {
        try {
          body(item)
          cb()
        } catch (error) {
          cb(error as Error)
        }
      })
    }, concurrency)
    q.error((err) => {
      if (err) reject(err)
    })
    for (let i = 0; i < n; i += 1) {
      q.push(jobs[i]!, (err) => {
        if (err) {
          reject(err)
          return
        }
        remaining -= 1
        if (remaining === 0) resolve()
      })
    }
  })

export const runPayloadDrainMatrix = async (options: {
  jobs: readonly Uint8Array[]
  concurrency: number
  jobCount: number
  body: Body
  label: string
}): Promise<void> => {
  const { jobs, concurrency, jobCount, body, label } = options
  const bench = new Bench({ time: 800, warmupTime: 150 })

  bench
    .add('@qkitt/tinyq withWorker', async () => {
      await drainQkitt(jobs, concurrency, body, label)
    })
    .add('fastq', async () => {
      await drainFastq(jobs, concurrency, body)
    })
    .add('p-queue', async () => {
      await drainPQueue(jobs, concurrency, body)
    })
    .add('async.queue', async () => {
      await drainAsyncQueue(jobs, concurrency, body)
    })

  await bench.run()
  printTimingTable(bench, { jobCount })
}
