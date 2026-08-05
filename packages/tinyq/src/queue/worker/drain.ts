import {
    cancelTimeout,
    scheduleTimeout,
} from '../../util/schedule-timeout.util'
import { LifecycleTimeoutError } from './lifecycle-timeout-error'
import { resolveTimeoutMs } from './resolve-timeout-ms.util'

/** Minimal surface for {@link drain}. */
export type Drainable = {
    on: (event: 'worker:idle', cb: () => void) => () => void
    isEmpty: () => boolean
    isProcessing: () => boolean
}

export type DrainOptions = {
    /** Reject with {@link LifecycleTimeoutError} if drain does not finish in time. */
    timeoutMs?: number
}

/**
 * Resolve when the worker queue is empty and nothing is in flight.
 *
 * Same idle condition as {@link import('./when-idle').whenIdle}, but named for
 * the “keep running until empty” lifecycle (callers typically leave the pump
 * running). Distinct from {@link import('./graceful-stop').gracefulStop}, which
 * stops taking new work first.
 *
 * **Without `timeoutMs` the promise can hang forever** (stopped pump with
 * remaining items, stuck job). Prefer a budget in production and tests.
 * On a worker with an aborted `signal` and remaining work, `withWorker`’s
 * `drain` rejects immediately with `WorkerAbortedError` instead of hanging.
 */
export const drain = (
    queue: Drainable,
    options: DrainOptions = {},
): Promise<void> => {
    const timeoutMs = resolveTimeoutMs(options.timeoutMs)

    return new Promise((resolve, reject) => {
        let settled = false
        let timer: unknown

        const cleanup = (): void => {
            off()
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

        const off = queue.on('worker:idle', () => {
            finish(() => {
                resolve()
            })
        })

        if (timeoutMs !== undefined) {
            timer = scheduleTimeout(() => {
                finish(() => {
                    reject(
                        new LifecycleTimeoutError(
                            `drain timed out after ${timeoutMs}ms`,
                            timeoutMs,
                        ),
                    )
                })
            }, timeoutMs)
        }

        if (queue.isEmpty() && !queue.isProcessing()) {
            finish(() => {
                resolve()
            })
        }
    })
}
