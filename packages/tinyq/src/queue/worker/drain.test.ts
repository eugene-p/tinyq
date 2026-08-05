import { describe, expect, it } from 'vitest'
import { buildQueue } from '../core/queue'
import { LifecycleTimeoutError } from './lifecycle-timeout-error'
import { withWorker } from './with-worker'

describe('worker.drain', () => {
    it('resolves when empty and idle', async () => {
        const queue = withWorker(buildQueue<number>(), async (n) => n)
        queue.enqueue(1)
        queue.enqueue(2)
        await queue.drain({ timeoutMs: 5_000 })
        expect(queue.isEmpty()).toBe(true)
        expect(queue.isProcessing()).toBe(false)
    })

    it('rejects on timeout', async () => {
        const queue = withWorker(
            buildQueue<number>(),
            async () => {
                await new Promise<void>((r) => {
                    const schedule = (
                        globalThis as unknown as {
                            setTimeout: (cb: () => void, ms: number) => unknown
                        }
                    ).setTimeout
                    schedule(r, 500)
                })
            },
            { concurrency: 1 },
        )
        queue.enqueue(1)
        await expect(queue.drain({ timeoutMs: 20 })).rejects.toBeInstanceOf(
            LifecycleTimeoutError,
        )
        queue.stop()
    })
})
