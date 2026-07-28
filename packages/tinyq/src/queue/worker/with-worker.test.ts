import { describe, expect, it, vi } from 'vitest'
import { buildQueue } from '../core/queue'
import { whenIdle } from './when-idle'
import { InvalidWorkerOptionError, withWorker } from './with-worker'

const flush = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
        await Promise.resolve()
    }
}

/** Fail stuck drains instead of hanging the suite. */
const IDLE_TIMEOUT_MS = 5_000

const waitForIdle = (
    queue: Parameters<typeof whenIdle>[0],
    timeoutMs = IDLE_TIMEOUT_MS,
) => whenIdle(queue, { timeoutMs })

describe('withWorker', () => {
    it('processes items in FIFO order', async () => {
        const order: number[] = []
        const queue = withWorker(buildQueue<number>(), async (item) => {
            order.push(item)
            return item * 2
        })

        queue.enqueue(1)
        queue.enqueue(2)
        queue.enqueue(3)
        await waitForIdle(queue)

        expect(order).toEqual([1, 2, 3])
        expect(queue.isEmpty()).toBe(true)
        expect(queue.isProcessing()).toBe(false)
    })

    it('emits started, completed, and idle events', async () => {
        const queue = withWorker(buildQueue<string>(), async (item) => item.toUpperCase())

        const started = vi.fn()
        const completed = vi.fn()
        const idle = vi.fn()

        queue.on('worker:started', started)
        queue.on('worker:completed', completed)
        queue.on('worker:idle', idle)

        queue.enqueue('a')
        await waitForIdle(queue)

        expect(started).toHaveBeenCalledWith({ item: 'a' })
        expect(completed).toHaveBeenCalledWith({ item: 'a', result: 'A' })
        expect(idle).toHaveBeenCalledOnce()
    })

    it('emits worker:failed when the worker throws', async () => {
        const error = new Error('boom')
        const queue = withWorker(buildQueue<number>(), async () => {
            throw error
        })

        const failed = vi.fn()
        queue.on('worker:failed', failed)

        queue.enqueue(1)
        await waitForIdle(queue)

        expect(failed).toHaveBeenCalledWith({ item: 1, error })
        expect(queue.isEmpty()).toBe(true)
    })

    it('does not start when autoStart is false until start() is called', async () => {
        const worker = vi.fn(async (item: number) => item)
        const queue = withWorker(buildQueue<number>(), worker, { autoStart: false })

        queue.enqueue(1)
        await flush()

        expect(worker).not.toHaveBeenCalled()
        expect(queue.size()).toBe(1)
        expect(queue.isRunning()).toBe(false)

        queue.start()
        expect(queue.isRunning()).toBe(true)
        await waitForIdle(queue)

        expect(worker).toHaveBeenCalledWith(1)
    })

    it('autoStart false does not process until start() (direct pump, no enqueued listener)', () => {
        const bare = buildQueue<number>()
        const onSpy = vi.spyOn(bare, 'on')
        const worker = vi.fn(async (item: number) => item)
        const queue = withWorker(bare, worker, { autoStart: false })

        const enqueuedCalls = () =>
            onSpy.mock.calls.filter(([eventName]) => eventName === 'queue:enqueued')

        // Worker pumps via overridden enqueue — never subscribes to queue:enqueued.
        expect(enqueuedCalls()).toHaveLength(0)
        queue.start()
        expect(enqueuedCalls()).toHaveLength(0)
        queue.start()
        expect(enqueuedCalls()).toHaveLength(0)
    })

    it('stop pauses pumping; later start restores processing', async () => {
        const worker = vi.fn(async (item: number) => item)
        const queue = withWorker(buildQueue<number>(), worker, {
            autoStart: false,
        })

        queue.start()

        queue.enqueue(1)
        await waitForIdle(queue)
        expect(worker).toHaveBeenCalledWith(1)

        queue.stop()
        expect(queue.isRunning()).toBe(false)

        worker.mockClear()
        queue.enqueue(2)
        await flush(3)
        expect(worker).not.toHaveBeenCalled()
        expect(queue.size()).toBe(1)

        queue.start()
        await waitForIdle(queue)
        expect(worker).toHaveBeenCalledWith(2)
        expect(queue.isEmpty()).toBe(true)
    })

    it('stop prevents taking new items while in-flight work finishes', async () => {
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })

        const worker = vi.fn(async (item: number) => {
            if (item === 1) await gate
            return item
        })

        const queue = withWorker(buildQueue<number>(), worker, { concurrency: 1 })

        queue.enqueue(1)
        queue.enqueue(2)
        await flush()

        expect(worker).toHaveBeenCalledTimes(1)
        expect(queue.isProcessing()).toBe(true)
        expect(queue.activeCount()).toBe(1)

        queue.stop()
        release()
        await flush()
        await flush()

        expect(worker).toHaveBeenCalledTimes(1)
        expect(queue.size()).toBe(1)
        expect(queue.peek()).toBe(2)
        expect(queue.isRunning()).toBe(false)
    })

    it('respects concurrency', async () => {
        let current = 0
        let maxConcurrent = 0
        const releases: Array<() => void> = []

        const worker = vi.fn(async (item: number) => {
            current += 1
            maxConcurrent = Math.max(maxConcurrent, current)
            await new Promise<void>((resolve) => {
                releases.push(resolve)
            })
            current -= 1
            return item
        })

        const queue = withWorker(buildQueue<number>(), worker, { concurrency: 2 })

        queue.enqueue(1)
        queue.enqueue(2)
        queue.enqueue(3)
        await flush(3)

        expect(worker).toHaveBeenCalledTimes(2)
        expect(queue.activeCount()).toBe(2)
        expect(maxConcurrent).toBe(2)

        releases[0]!()
        await flush(5)

        expect(worker).toHaveBeenCalledTimes(3)

        releases[1]!()
        releases[2]!()
        await flush(5)

        expect(queue.isEmpty()).toBe(true)
        expect(queue.isProcessing()).toBe(false)
    })

    it('still exposes the underlying queue API', async () => {
        const queue = withWorker(buildQueue<number>(), async (n) => n)

        const enqueued = vi.fn()
        queue.on('queue:enqueued', enqueued)

        queue.enqueue(42)
        await waitForIdle(queue)

        expect(enqueued).toHaveBeenCalledWith({ item: 42, size: 1 })
        // dequeued by the worker
        expect(queue.size()).toBe(0)
    })

    it('rejects non-integer concurrency', () => {
        expect(() =>
            withWorker(buildQueue<number>(), async (n) => n, {
                concurrency: NaN,
            }),
        ).toThrow(InvalidWorkerOptionError)
        expect(() =>
            withWorker(buildQueue<number>(), async (n) => n, {
                concurrency: 0,
            }),
        ).toThrow(InvalidWorkerOptionError)
        expect(() =>
            withWorker(buildQueue<number>(), async (n) => n, {
                concurrency: 1.5,
            }),
        ).toThrow(InvalidWorkerOptionError)
        expect(() =>
            withWorker(buildQueue<number>(), async (n) => n, {
                concurrency: Infinity,
            }),
        ).toThrow(InvalidWorkerOptionError)
        expect(() =>
            withWorker(buildQueue<number>(), async (n) => n, {
                concurrency: -1,
            }),
        ).toThrow(InvalidWorkerOptionError)
    })

    it('emits worker:pump-error and stops on unexpected dequeue failures', async () => {
        const queue = buildQueue<number>()
        const originalDequeue = queue.dequeue.bind(queue)
        let failNext = false
        const boom = new Error('custom dequeue failure')
        queue.dequeue = () => {
            if (failNext) {
                throw boom
            }
            return originalDequeue()
        }

        let release!: () => void
        const hold = new Promise<void>((resolve) => {
            release = resolve
        })

        const workerQueue = withWorker(
            queue,
            async (item) => {
                if (item === 1) await hold
                return item
            },
            { concurrency: 1 },
        )
        const pumpError = vi.fn()
        workerQueue.on('worker:pump-error', pumpError)

        workerQueue.enqueue(1)
        workerQueue.enqueue(2)
        await flush()

        failNext = true
        release()
        await flush(5)

        expect(pumpError).toHaveBeenCalledWith({ error: boom })
        expect(workerQueue.isRunning()).toBe(false)
        expect(workerQueue.size()).toBe(1)
        expect(workerQueue.peek()).toBe(2)

        // Enqueue while stopped does not resume processing.
        failNext = false
        workerQueue.enqueue(3)
        await flush(5)
        expect(workerQueue.size()).toBe(2)

        // Explicit start recovers after the failure is fixed.
        workerQueue.start()
        await waitForIdle(workerQueue)
        expect(workerQueue.isEmpty()).toBe(true)
    })

    it('processes undefined and null payloads (not treated as empty)', async () => {
        const seen: Array<string | null | undefined> = []
        const queue = withWorker(
            buildQueue<string | null | undefined>(),
            async (item) => {
                seen.push(item)
                return item
            },
        )

        queue.enqueue(undefined)
        queue.enqueue(null)
        queue.enqueue('done')
        await waitForIdle(queue)

        expect(seen).toEqual([undefined, null, 'done'])
        expect(queue.isEmpty()).toBe(true)
    })

    it('runs sync workers without an outer async hop', async () => {
        const order: number[] = []
        const queue = withWorker(buildQueue<number>(), (item) => {
            order.push(item)
            return item * 2
        })

        const completed = vi.fn()
        queue.on('worker:completed', completed)

        queue.enqueue(1)
        queue.enqueue(2)
        await waitForIdle(queue)

        expect(order).toEqual([1, 2])
        expect(completed).toHaveBeenNthCalledWith(1, { item: 1, result: 2 })
        expect(completed).toHaveBeenNthCalledWith(2, { item: 2, result: 4 })
    })

    it('drains many sync jobs without stack overflow', async () => {
        const n = 5_000
        let count = 0
        const queue = withWorker(buildQueue<number>(), (item) => {
            count += 1
            return item
        })

        for (let i = 0; i < n; i += 1) queue.enqueue(i)
        await waitForIdle(queue)

        expect(count).toBe(n)
        expect(queue.isEmpty()).toBe(true)
    })

    it('emits worker:failed when a sync worker throws', async () => {
        const error = new Error('sync boom')
        const queue = withWorker(buildQueue<number>(), () => {
            throw error
        })

        const failed = vi.fn()
        queue.on('worker:failed', failed)

        queue.enqueue(1)
        await waitForIdle(queue)

        expect(failed).toHaveBeenCalledWith({ item: 1, error })
    })
})
