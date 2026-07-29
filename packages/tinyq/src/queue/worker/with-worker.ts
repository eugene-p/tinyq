import {
    type EventCallback,
    type EventMap,
    type MergeEventMaps,
} from '../../events'
import { createSubscriptionCounts } from '../../events/subscription-counts'
import { isIntegerInRange } from '../../util/number.util'
import type { WorkerFn } from '../../worker/types'
import {
    decorateQueue,
    type PreserveQueueExtras,
} from '../core/forward.util'
import { markQueueLayer, WORKER_LAYER } from '../core/layers.util'
import type { Queue, QueueEvents } from '../core/queue'
import {
    gracefulStop as runGracefulStop,
    type GracefulStopable,
    type GracefulStopOptions,
} from './graceful-stop'
import { InvalidWorkerOptionError } from './invalid-worker-option-error'

export { InvalidWorkerOptionError } from './invalid-worker-option-error'

export type WorkerEvents<T, R = unknown> = {
    /** Fired just before the worker runs an item. */
    'worker:started': { item: T }
    /** Fired when the worker resolves successfully. */
    'worker:completed': { item: T; result: R }
    /** Fired when the worker throws or rejects. */
    'worker:failed': { item: T; error: unknown }
    /** Fired when nothing is in-flight and the queue is empty. */
    'worker:idle': undefined
    /**
     * Fired when dequeue throws an unexpected error.
     * The worker stops taking new items; call `start()` after fixing the cause.
     */
    'worker:pump-error': { error: unknown }
}

export type WithWorkerOptions = {
    /** Max items processed at the same time. Defaults to 1. Must be a safe integer ≥ 1. */
    concurrency?: number
    /** Start pumping immediately. Defaults to true. */
    autoStart?: boolean
}

type WorkerQueueEvents<T, R, TEvents extends EventMap> = MergeEventMaps<
    TEvents,
    WorkerEvents<T, R>
>

export type WorkerControls = {
    /** Begin processing queued items. */
    start: () => void
    /** Stop taking new items. In-flight work still finishes. */
    stop: () => void
    /**
     * Stop taking new items, wait for in-flight work, optionally `flush`.
     * Remaining queued items are left in place (not a full drain).
     */
    gracefulStop: (options?: GracefulStopOptions) => Promise<void>
    /** Whether the worker is allowed to take new items. */
    isRunning: () => boolean
    /** Whether any items are currently being processed. */
    isProcessing: () => boolean
    /** Number of items currently being processed. */
    activeCount: () => number
}

export type QueueWithWorker<
    T,
    R = unknown,
    TEvents extends EventMap = WorkerQueueEvents<T, R, QueueEvents<T>>,
> = Queue<T, TEvents> & WorkerControls

const resolveConcurrency = (value: number | undefined): number => {
    const concurrency = value ?? 1
    if (!isIntegerInRange(concurrency, 1)) {
        throw new InvalidWorkerOptionError(
            'concurrency must be a safe integer >= 1',
        )
    }
    return concurrency
}

/** Thenable check — same unwrapping surface as `await` (not only native Promise). */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    value != null && typeof (value as { then?: unknown }).then === 'function'

/**
 * Wrap a queue with a worker that dequeues and processes items FIFO-style.
 *
 * The worker **overrides `enqueue` / `replaceAll`** to pump directly instead of
 * subscribing to `queue:enqueued`. That keeps the hot path free of event
 * payload allocation when only the worker is driving drain. Call methods on the
 * returned queue (not a retained bare inner reference) so pumping stays wired.
 *
 * Failed items are **not** re-queued. Use `retryWorker` for in-call retries,
 * `withDeadLetter` / `withDlq` for a separate sink, `withLoop` to re-enter the
 * same queue with hop meta, or handle `worker:failed` yourself.
 *
 * Inner decorator extras are preserved at runtime and in the return type.
 *
 * Dequeue failures emit `worker:pump-error` and stop the worker. Nullish
 * payloads are valid — the pump uses {@link import('../core/queue').Queue.takeTo}
 * so emptiness is structural (one check, no per-item
 * {@link import('../core/queue').QueueSlot} allocation).
 *
 * Mutators are read live off `inner` so bare→event method swaps on first
 * `queue.on` still apply under the worker.
 */
export const withWorker = <
    T,
    R = unknown,
    TEvents extends QueueEvents<T> = QueueEvents<T>,
    TQueue extends Queue<T, TEvents> = Queue<T, TEvents>,
>(
    queue: TQueue & Queue<T, TEvents>,
    worker: WorkerFn<T, R>,
    options: WithWorkerOptions = {},
): QueueWithWorker<T, R, WorkerQueueEvents<T, R, TEvents>> &
    PreserveQueueExtras<TQueue> => {
    const concurrency = resolveConcurrency(options.concurrency)
    const autoStart = options.autoStart ?? true

    const inner = queue
    /** Reused by the pump — never retained across async turns as the sole item ref. */
    const takeOut: { value: T } = { value: undefined as T }
    const emitInner = inner.emit as (
        eventName: string,
        data: unknown,
    ) => void
    const onInner = inner.on as (
        eventName: string,
        callback: EventCallback<unknown>,
    ) => () => void
    const { counts: subs, wrapOn } = createSubscriptionCounts({
        started: 'worker:started',
        completed: 'worker:completed',
        failed: 'worker:failed',
        idle: 'worker:idle',
        pumpError: 'worker:pump-error',
    })
    const on = wrapOn(onInner) as QueueWithWorker<
        T,
        R,
        WorkerQueueEvents<T, R, TEvents>
    >['on']

    let running = false
    let active = 0
    /** Prevents nested pump when a sync worker finishes inside the pump loop. */
    let pumping = false

    const finishItem = (): void => {
        active -= 1

        if (active === 0 && inner.isEmpty() && subs.idle > 0) {
            emitInner('worker:idle', undefined)
        }

        // Sync completions re-enter the open `while` via `active--` only.
        // Async completions need an explicit pump after the microtask.
        if (!pumping) {
            pump()
        }
    }

    const processItem = (item: T): void => {
        if (subs.started > 0) {
            emitInner('worker:started', { item })
        }

        let ret: R | PromiseLike<R>
        try {
            ret = worker(item)
        } catch (error) {
            if (subs.failed > 0) {
                emitInner('worker:failed', { item, error })
            }
            finishItem()
            return
        }

        if (isThenable(ret)) {
            // Direct thenable hop — no `Promise.resolve` wrapper allocation.
            try {
                ret.then(
                    (result) => {
                        if (subs.completed > 0) {
                            emitInner('worker:completed', {
                                item,
                                result: result as R,
                            })
                        }
                        finishItem()
                    },
                    (error: unknown) => {
                        if (subs.failed > 0) {
                            emitInner('worker:failed', { item, error })
                        }
                        finishItem()
                    },
                )
            } catch (error) {
                if (subs.failed > 0) {
                    emitInner('worker:failed', { item, error })
                }
                finishItem()
            }
            return
        }

        if (subs.completed > 0) {
            emitInner('worker:completed', { item, result: ret })
        }
        finishItem()
    }

    const stop = (): void => {
        running = false
    }

    const pump = (): void => {
        if (pumping) return
        pumping = true
        // Resolve once per pump — bare→loud may swap on queue:* subscribe,
        // but not mid-drain under normal use.
        const takeTo = inner.takeTo
        try {
            while (running && active < concurrency) {
                // takeTo: one emptiness check; nullish payloads remain valid.
                if (!takeTo(takeOut)) break
                const item = takeOut.value
                active += 1
                processItem(item)
            }
        } catch (error) {
            // Unexpected dequeue failure: surface and stop so it is not silent.
            if (subs.pumpError > 0) {
                emitInner('worker:pump-error', { error })
            }
            stop()
        } finally {
            pumping = false
        }
    }

    const start = (): void => {
        if (running) return
        running = true
        pump()
    }

    /** Enqueue then pump — no `queue:enqueued` subscription on the hot path. */
    const enqueue = (item: T): void => {
        // Live property: bare→loud swap on first queue:* subscriber.
        inner.enqueue(item)
        pump()
    }

    /** Bulk load then pump so preloaded work starts without a separate start race. */
    const replaceAll = (items: readonly T[]): void => {
        inner.replaceAll(items)
        pump()
    }

    if (autoStart) {
        start()
    }

    const isProcessing = (): boolean => active > 0

    const gracefulStop = (options?: GracefulStopOptions): Promise<void> => {
        const flush = (inner as { flush?: () => void | PromiseLike<void> })
            .flush
        return runGracefulStop(
            {
                stop,
                isProcessing,
                on: on as GracefulStopable['on'],
                ...(typeof flush === 'function'
                    ? {
                          flush: () =>
                              (
                                  flush as () => void | PromiseLike<void>
                              ).call(inner),
                      }
                    : {}),
            },
            options,
        )
    }

    const api = markQueueLayer(
        decorateQueue(inner, {
            on,
            enqueue,
            replaceAll,
            start,
            stop,
            gracefulStop,
            isRunning: () => running,
            isProcessing,
            activeCount: () => active,
        }),
        WORKER_LAYER,
    )

    return api as unknown as QueueWithWorker<
        T,
        R,
        WorkerQueueEvents<T, R, TEvents>
    > &
        PreserveQueueExtras<TQueue>
}
