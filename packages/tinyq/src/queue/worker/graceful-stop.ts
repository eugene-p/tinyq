import {
    cancelTimeout,
    scheduleMicrotask,
    scheduleTimeout,
} from '../../util/schedule-timeout.util'
import { LifecycleTimeoutError } from './lifecycle-timeout-error'
import { resolveTimeoutMs } from './resolve-timeout-ms.util'

/** Minimal surface for {@link gracefulStop}. */
export type GracefulStopable = {
    stop: () => void
    isProcessing: () => boolean
    on: (event: 'worker:settled', cb: () => void) => () => void
    flush?: () => void | PromiseLike<void>
}

export type GracefulStopOptions = {
    /**
     * When true, await `flush()` after in-flight work settles if the queue
     * exposes it. Default false (opt-in).
     */
    flush?: boolean
    /**
     * Reject with {@link LifecycleTimeoutError} if settle (and optional flush)
     * exceed this budget. Does not cancel in-flight workers or an in-progress
     * flush — only rejects the returned promise.
     */
    timeoutMs?: number
}

const runFlush = async (queue: GracefulStopable): Promise<void> => {
    const flush = queue.flush
    if (typeof flush !== 'function') return
    await flush()
}

/**
 * Stop taking new items, wait for in-flight work to finish, optionally flush.
 *
 * Unlike {@link import('./when-idle').whenIdle}, this does **not** require an
 * empty queue — remaining items stay queued (typical SIGTERM path).
 *
 * Waits on `worker:settled` (emitted after each async item finishes, including
 * the no-listener fast path) rather than `worker:completed` / `worker:failed`,
 * so late subscription still observes in-flight work.
 *
 * **Without `timeoutMs` the promise can hang forever** if in-flight work or an
 * opt-in `flush()` never settles. Prefer a budget so callers fail closed with
 * {@link LifecycleTimeoutError} (in-flight work is not cancelled — only the
 * waiter rejects).
 */
export const gracefulStop = (
    queue: GracefulStopable,
    options: GracefulStopOptions = {},
): Promise<void> => {
    const timeoutMs = resolveTimeoutMs(options.timeoutMs)
    const shouldFlush = options.flush === true

    return new Promise((resolve, reject) => {
        let settled = false
        /** Prevents concurrent completion waves from starting flush twice. */
        let settling = false
        let timer: unknown
        let offSettled: (() => void) | undefined

        const cleanup = (): void => {
            offSettled?.()
            offSettled = undefined
            if (timer !== undefined) {
                cancelTimeout(timer)
                timer = undefined
            }
        }

        const finish = (action: () => void): void => {
            if (settled) return
            settled = true
            cleanup()
            action()
        }

        const settle = (): void => {
            if (settled || settling) return
            if (queue.isProcessing()) return

            settling = true
            // Drop listeners as soon as settle starts (before await flush).
            offSettled?.()
            offSettled = undefined

            void (async () => {
                try {
                    if (shouldFlush) {
                        await runFlush(queue)
                    }
                    finish(() => {
                        resolve()
                    })
                } catch (error) {
                    finish(() => {
                        reject(error)
                    })
                }
            })()
        }

        // finishAsync decrements `active` then emits settled — microtask keeps
        // settle() off the emit stack (flush / re-entrancy safety).
        const onItemDone = (): void => {
            scheduleMicrotask(settle)
        }

        queue.stop()

        offSettled = queue.on('worker:settled', onItemDone)

        if (timeoutMs !== undefined) {
            timer = scheduleTimeout(() => {
                finish(() => {
                    reject(
                        new LifecycleTimeoutError(
                            `gracefulStop timed out after ${timeoutMs}ms`,
                            timeoutMs,
                        ),
                    )
                })
            }, timeoutMs)
        }

        settle()
    })
}
