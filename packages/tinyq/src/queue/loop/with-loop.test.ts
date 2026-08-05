import { describe, expect, it, vi } from 'vitest'
import { InvalidQueueCompositionError } from '../core/composition-error'
import { buildQueue } from '../core/queue'
import { whenIdle } from '../worker/when-idle'
import { withWorker } from '../worker/with-worker'
import { TQ_KEY } from './hop-meta.util'
import {
    getLoopHops,
    InvalidLoopOptionError,
    LoopEnqueueError,
    withLoop,
} from './with-loop'

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

const named = <T>(name: string) => buildQueue<T>({ name })

describe('withLoop', () => {
    it('tracks pending delay timers and can cancel them on stop', async () => {
        vi.useFakeTimers()
        try {
            const queue = withLoop(
                withWorker(
                    named<number>('jobs'),
                    async () => {
                        throw new Error('fail')
                    },
                    { autoStart: true },
                ),
                { delay: 1_000, cancelDelayedOnStop: true },
            )

            queue.enqueue(1)
            await flush(4)
            expect(queue.pendingDelayedCount()).toBe(1)
            queue.stop()
            expect(queue.pendingDelayedCount()).toBe(0)
            await vi.advanceTimersByTimeAsync(2_000)
            expect(queue.size()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it('throws when source has no worker layer', () => {
        expect(() =>
            withLoop(
                // @ts-expect-error bare queue lacks worker controls
                named<number>('jobs'),
            ),
        ).toThrow(InvalidQueueCompositionError)
    })

    it('throws when queue has no name', () => {
        const q = withWorker(buildQueue<{ id: string }>(), async () => {
            throw new Error('x')
        })
        expect(() => withLoop(q)).toThrow(InvalidLoopOptionError)
    })

    it('increments __tq.loop[name].hops on each failure', async () => {
        type Job = { id: string; __tq?: unknown }
        const run = vi.fn(async (job: Job) => {
            const hops = getLoopHops(job, 'jobs')
            if (hops === undefined || hops < 2) {
                throw new Error(`fail-${hops ?? 0}`)
            }
        })

        const queue = withLoop(withWorker(named<Job>('jobs'), run))

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(6)

        expect(run.mock.calls.length).toBeGreaterThanOrEqual(3)
        const last = run.mock.calls.at(-1)?.[0]
        expect(getLoopHops(last, 'jobs')).toBe(2)
        expect(last).toMatchObject({
            id: 'a',
            [TQ_KEY]: { loop: { jobs: { hops: 2 } } },
        })
        expect(queue.isEmpty()).toBe(true)
    })

    it('preserves user fields and sibling library tags', async () => {
        type Job = {
            id: string
            note?: string
            __tq?: {
                loop?: Record<string, { hops?: number; note?: string }>
                otherTag?: number
            }
        }

        let resolved: Job | undefined
        const queue = withLoop(
            withWorker(named<Job>('jobs'), async (job) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
                resolved = job
            }),
        )

        queue.enqueue({
            id: 'a',
            note: 'user',
            [TQ_KEY]: {
                otherTag: 7,
                loop: { jobs: { note: 'keep' }, billing: { hops: 3 } },
            },
        })
        await waitForIdle(queue)
        await flush(4)

        expect(resolved).toEqual({
            id: 'a',
            note: 'user',
            [TQ_KEY]: {
                otherTag: 7,
                loop: {
                    jobs: { note: 'keep', hops: 1 },
                    billing: { hops: 3 },
                },
            },
        })
    })

    it('wraps primitives with value + __tq', async () => {
        let saw: unknown
        const queue = withLoop(
            withWorker(named<unknown>('n'), async (item) => {
                if (typeof item === 'number') {
                    throw new Error('fail')
                }
                saw = item
            }),
        )

        queue.enqueue(9)
        await waitForIdle(queue)
        await flush(4)

        expect(saw).toEqual({
            value: 9,
            [TQ_KEY]: { loop: { n: { hops: 1 } } },
        })
    })

    it('wraps Date instead of spreading', async () => {
        let saw: unknown
        const when = new Date('2020-01-01T00:00:00.000Z')
        const queue = withLoop(
            withWorker(named<unknown>('jobs'), async (item) => {
                if (item instanceof Date) {
                    throw new Error('fail')
                }
                saw = item
            }),
        )

        queue.enqueue(when)
        await waitForIdle(queue)
        await flush(4)

        expect(saw).toEqual({
            value: when,
            [TQ_KEY]: { loop: { jobs: { hops: 1 } } },
        })
    })

    it('uses trimmed buildQueue name for hop meta keys', async () => {
        let resolved: unknown
        const queue = withLoop(
            withWorker(buildQueue<{ id: string }>({ name: '  jobs  ' }), async (job) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
                resolved = job
            }),
        )

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(getLoopHops(resolved, 'jobs')).toBe(1)
    })

    it('applies user map then stamps hops', async () => {
        const received: unknown[] = []
        let pass = 0
        const queue = withLoop(
            withWorker(named<{ id: string }>('jobs'), async (item) => {
                received.push(item)
                pass += 1
                if (pass === 1) throw new Error('fail')
            }),
            {
                map: (item, error, ctx) => ({
                    id: item.id,
                    reason: error instanceof Error ? error.message : 'x',
                    hopsSeen: ctx.hops,
                }),
            },
        )

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(received[1]).toEqual({
            id: 'a',
            reason: 'fail',
            hopsSeen: 1,
            [TQ_KEY]: { loop: { jobs: { hops: 1 } } },
        })
        expect(getLoopHops(received[1], 'jobs')).toBe(1)
    })

    it('emits loop:meta-override when map changes __tq, then re-stamps', async () => {
        const override = vi.fn()
        let saw: unknown
        const queue = withLoop(
            withWorker(named<{ id: string }>('jobs'), async (job) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
                saw = job
            }),
            {
                map: (item) => ({
                    ...item,
                    [TQ_KEY]: { loop: { jobs: { hops: 99 } } },
                }),
            },
        )
        queue.on('loop:meta-override', override)

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(override).toHaveBeenCalledOnce()
        expect(override.mock.calls[0]?.[0]).toMatchObject({
            name: 'jobs',
            attempted: { loop: { jobs: { hops: 99 } } },
            applied: { hops: 1 },
        })
        expect(getLoopHops(saw, 'jobs')).toBe(1)
    })

    it('does not emit meta-override when map returns original unchanged bag', async () => {
        const override = vi.fn()
        const queue = withLoop(
            withWorker(named<{ id: string }>('jobs'), async (job) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
            }),
            {
                map: (item) => item,
            },
        )
        queue.on('loop:meta-override', override)

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(override).not.toHaveBeenCalled()
    })

    it('skips re-enqueue when filter returns false', async () => {
        const run = vi.fn(async () => {
            throw new Error('fail')
        })
        const queue = withLoop(withWorker(named<number>('n'), run), {
            filter: () => false,
        })

        queue.enqueue(1)
        await waitForIdle(queue)
        await flush(2)

        expect(run).toHaveBeenCalledOnce()
        expect(queue.isEmpty()).toBe(true)
    })

    it('emits loop:error when map throws', async () => {
        const mapErr = new Error('map-fail')
        const queue = withLoop(
            withWorker(named<number>('jobs'), async () => {
                throw new Error('worker')
            }),
            {
                map: () => {
                    throw mapErr
                },
            },
        )

        const onError = vi.fn()
        queue.on('loop:error', onError)

        queue.enqueue(1)
        await waitForIdle(queue)

        const cause = onError.mock.calls[0]?.[0].cause as LoopEnqueueError
        expect(cause).toBeInstanceOf(LoopEnqueueError)
        expect(cause.cause).toBe(mapErr)
    })

    it('emits loop:enqueued on successful re-enqueue', async () => {
        const enqueued = vi.fn()
        const queue = withLoop(
            withWorker(named<{ id: string }>('jobs'), async (job) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
            }),
        )
        queue.on('loop:enqueued', enqueued)

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(enqueued).toHaveBeenCalledOnce()
        expect(enqueued.mock.calls[0]?.[0].loopItem).toMatchObject({
            id: 'a',
            [TQ_KEY]: { loop: { jobs: { hops: 1 } } },
        })
    })

    it('still emits worker:failed', async () => {
        const error = new Error('boom')
        const failed = vi.fn()
        const queue = withLoop(
            withWorker(named<{ id: string }>('jobs'), async () => {
                throw error
            }),
            { filter: () => false },
        )
        queue.on('worker:failed', failed)

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)

        expect(failed).toHaveBeenCalledWith({ item: { id: 'a' }, error })
    })

    it('reads name through worker and loop decorator layers', async () => {
        let sawName: string | undefined
        const queue = withLoop(
            withWorker(named<{ id: string }>('orders'), async (job) => {
                if (getLoopHops(job, 'orders') === undefined) {
                    throw new Error('fail')
                }
            }),
            {
                map: (_item, _error, ctx) => {
                    sawName = ctx.name
                    return _item
                },
            },
        )

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(sawName).toBe('orders')
    })

    it('rejects invalid static delay at wrap time', () => {
        const inner = withWorker(named<number>('jobs'), async () => {
            throw new Error('x')
        })
        expect(() => withLoop(inner, { delay: -1 })).toThrow(
            InvalidLoopOptionError,
        )
        expect(() => withLoop(inner, { delay: NaN })).toThrow(
            InvalidLoopOptionError,
        )
        expect(() => withLoop(inner, { delay: Infinity })).toThrow(
            InvalidLoopOptionError,
        )
    })

    it('waits static delay before re-enqueue', async () => {
        vi.useFakeTimers()
        try {
            const run = vi.fn(async (job: { id: string }) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
            })
            const enqueued = vi.fn()
            const queue = withLoop(withWorker(named<{ id: string }>('jobs'), run), {
                delay: 50,
            })
            queue.on('loop:enqueued', enqueued)

            queue.enqueue({ id: 'a' })
            await vi.advanceTimersByTimeAsync(0)
            await flush(4)

            expect(run).toHaveBeenCalledOnce()
            expect(enqueued).not.toHaveBeenCalled()
            expect(queue.isEmpty()).toBe(true)

            await vi.advanceTimersByTimeAsync(49)
            expect(enqueued).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(1)
            await flush(6)

            expect(enqueued).toHaveBeenCalledOnce()
            expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
            expect(getLoopHops(run.mock.calls.at(-1)?.[0], 'jobs')).toBe(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('supports function delay with hop count', async () => {
        vi.useFakeTimers()
        try {
            const delayFn = vi.fn((hops: number) => 10 * hops)
            const run = vi.fn(async (job: { id: string }) => {
                const hops = getLoopHops(job, 'jobs')
                if (hops === undefined || hops < 2) {
                    throw new Error(`fail-${hops ?? 0}`)
                }
            })
            const queue = withLoop(withWorker(named<{ id: string }>('jobs'), run), {
                delay: delayFn,
            })

            queue.enqueue({ id: 'a' })
            await vi.advanceTimersByTimeAsync(0)
            await flush(4)

            expect(delayFn).toHaveBeenCalledOnce()
            expect(delayFn.mock.calls[0]?.[0]).toBe(1)
            expect(run).toHaveBeenCalledOnce()

            await vi.advanceTimersByTimeAsync(10)
            await flush(6)
            expect(run.mock.calls.length).toBe(2)
            expect(delayFn).toHaveBeenCalledTimes(2)
            expect(delayFn.mock.calls[1]?.[0]).toBe(2)

            await vi.advanceTimersByTimeAsync(20)
            await flush(6)
            expect(run.mock.calls.length).toBe(3)
            expect(getLoopHops(run.mock.calls.at(-1)?.[0], 'jobs')).toBe(2)
        } finally {
            vi.useRealTimers()
        }
    })

    it('re-enqueues immediately when delay is 0', async () => {
        const enqueued = vi.fn()
        const queue = withLoop(
            withWorker(named<{ id: string }>('jobs'), async (job) => {
                if (getLoopHops(job, 'jobs') === undefined) {
                    throw new Error('fail')
                }
            }),
            { delay: 0 },
        )
        queue.on('loop:enqueued', enqueued)

        queue.enqueue({ id: 'a' })
        await waitForIdle(queue)
        await flush(4)

        expect(enqueued).toHaveBeenCalledOnce()
    })

    it('emits loop:error when delay callback returns invalid duration', async () => {
        const onError = vi.fn()
        const queue = withLoop(
            withWorker(named<number>('jobs'), async () => {
                throw new Error('worker')
            }),
            {
                delay: () => -1,
            },
        )
        queue.on('loop:error', onError)

        queue.enqueue(1)
        await waitForIdle(queue)

        const cause = onError.mock.calls[0]?.[0].cause as LoopEnqueueError
        expect(cause).toBeInstanceOf(LoopEnqueueError)
        expect(cause.cause).toBeInstanceOf(InvalidLoopOptionError)
    })

    it('does not schedule delay when filter returns false', async () => {
        vi.useFakeTimers()
        try {
            const delay = vi.fn(() => 100)
            const run = vi.fn(async () => {
                throw new Error('fail')
            })
            const queue = withLoop(withWorker(named<number>('n'), run), {
                filter: () => false,
                delay,
            })

            queue.enqueue(1)
            await vi.advanceTimersByTimeAsync(0)
            await flush(2)

            expect(run).toHaveBeenCalledOnce()
            expect(delay).not.toHaveBeenCalled()
            expect(queue.isEmpty()).toBe(true)

            await vi.advanceTimersByTimeAsync(200)
            expect(run).toHaveBeenCalledOnce()
        } finally {
            vi.useRealTimers()
        }
    })

    it('emits loop:error when delay callback throws', async () => {
        const delayErr = new Error('delay-boom')
        const onError = vi.fn()
        const queue = withLoop(
            withWorker(named<number>('jobs'), async () => {
                throw new Error('worker')
            }),
            {
                delay: () => {
                    throw delayErr
                },
            },
        )
        queue.on('loop:error', onError)

        queue.enqueue(1)
        await waitForIdle(queue)

        const cause = onError.mock.calls[0]?.[0].cause as LoopEnqueueError
        expect(cause).toBeInstanceOf(LoopEnqueueError)
        expect(cause.cause).toBe(delayErr)
    })

    it('emits loop:error when map throws after delay', async () => {
        vi.useFakeTimers()
        try {
            const mapErr = new Error('map-late')
            const onError = vi.fn()
            const queue = withLoop(
                withWorker(named<number>('jobs'), async () => {
                    throw new Error('worker')
                }),
                {
                    delay: 25,
                    map: () => {
                        throw mapErr
                    },
                },
            )
            queue.on('loop:error', onError)

            queue.enqueue(1)
            await vi.advanceTimersByTimeAsync(0)
            await flush(2)
            expect(onError).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(25)
            await flush(2)

            const cause = onError.mock.calls[0]?.[0].cause as LoopEnqueueError
            expect(cause).toBeInstanceOf(LoopEnqueueError)
            expect(cause.cause).toBe(mapErr)
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not throw from delayed re-enqueue when loop:error listener throws', async () => {
        vi.useFakeTimers()
        try {
            const queue = withLoop(
                withWorker(named<number>('jobs'), async () => {
                    throw new Error('worker')
                }),
                {
                    delay: 10,
                    map: () => {
                        throw new Error('map-late')
                    },
                },
            )
            queue.on('loop:error', () => {
                throw new Error('listener-boom')
            })

            queue.enqueue(1)
            await vi.advanceTimersByTimeAsync(0)
            await flush(2)

            // Timer callback must complete without an unhandled throw.
            await vi.advanceTimersByTimeAsync(10)
            await flush(2)
        } finally {
            vi.useRealTimers()
        }
    })
})
