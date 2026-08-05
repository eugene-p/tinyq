import {
    type EventCallback,
    type EventMap,
    type MergeEventMaps,
} from '../../events'
import { createSubscriptionCounts } from '../../events/subscription-counts'
import type { AbortSignalLike } from '../../util/abort-signal.util'
import { isIntegerInRange } from '../../util/number.util'
import {
    scheduleMicrotask,
} from '../../util/schedule-timeout.util'
import type { WorkerFn } from '../../worker/types'
import {
    decorateQueue,
    type PreserveQueueExtras,
} from '../core/forward.util'
import { markQueueLayer, WORKER_LAYER } from '../core/layers.util'
import type { Queue, QueueEvents, QueueStats } from '../core/queue'
import {
    gracefulStop as runGracefulStop,
    type GracefulStopable,
    type GracefulStopOptions,
} from './graceful-stop'
import {
    INTERNAL_FAILED_SUBSCRIBE,
    type InternalFailedHandler,
} from './internal-failed.util'
import { InvalidWorkerOptionError } from './invalid-worker-option-error'
import { drain as runDrain, type DrainOptions } from './drain'

export { InvalidWorkerOptionError } from './invalid-worker-option-error'

export type WorkerEvents<T, R = unknown> = {
    /** Fired just before the worker runs an item. */
    'worker:started': { item: T }
    /** Fired when the worker resolves successfully. */
    'worker:completed': { item: T; result: R }
    /** Fired when the worker throws or rejects. */
    'worker:failed': { item: T; error: unknown }
    /**
     * Fired after an async item settles (success or failure). No payload.
     * Checked at settle time so late subscribers (e.g. `gracefulStop`) still wake.
     */
    'worker:settled': undefined
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
    /**
     * When aborted, stops taking new items (same as {@link WorkerControls.stop}).
     * In-flight work is not cancelled.
     */
    signal?: AbortSignalLike
    /**
     * Coalesce async settle re-pumps into one microtask.
     * Default: auto-enable when `concurrency >= 4`.
     */
    batchRepump?: boolean
    /**
     * When true, {@link WorkerControls.stats} reports counters including
     * completed / failed / active.
     */
    trackStats?: boolean
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
    /**
     * Run until the queue is empty and idle, or reject on timeout.
     * Unlike {@link gracefulStop}, does not stop the pump first.
     */
    drain: (options?: DrainOptions) => Promise<void>
    /** Whether the worker is allowed to take new items. */
    isRunning: () => boolean
    /** Whether any items are currently being processed. */
    isProcessing: () => boolean
    /** Number of items currently being processed. */
    activeCount: () => number
    /**
     * Change concurrency at runtime.
     * Lowering below active lets in-flight finish; raising pumps more.
     */
    setConcurrency: (n: number) => void
    /** Current concurrency limit. */
    getConcurrency: () => number
    /** Stats when `trackStats` is enabled on the queue and/or worker. */
    stats?: () => QueueStats
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
 *
 * ## Sync vs async `active` tracking
 *
 * `active` counts items whose worker call has not yet settled (i.e. async
 * in-flight work). Sync items complete inside the pump loop iteration so they
 * never increment `active` — the loop itself serialises them and `active` is
 * always 0 for pure-sync workers. This keeps `isProcessing()` semantically
 * correct: nothing is in flight between loop iterations.
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
    let concurrency = resolveConcurrency(options.concurrency)
    const autoStart = options.autoStart ?? true
    const trackStats = options.trackStats === true
    const batchRepumpOpt = options.batchRepump

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
        settled: 'worker:settled',
        idle: 'worker:idle',
        pumpError: 'worker:pump-error',
    })
    const on = wrapOn(onInner) as QueueWithWorker<
        T,
        R,
        WorkerQueueEvents<T, R, TEvents>
    >['on']

    let running = false
    /** Counts async-only in-flight items. Sync items complete within the loop iteration. */
    let active = 0
    let pumping = false
    let pumpScheduled = false
    let completedCount = 0
    let failedCount = 0

    const internalHandlers: InternalFailedHandler<T>[] = []
    let internalFailed = 0

    const notifyInternalFailed = (item: T, error: unknown): void => {
        // Snapshot so a handler that unsubscribes mid-notify cannot skip the next.
        const handlers = internalHandlers.slice()
        for (let i = 0; i < handlers.length; i += 1) {
            try {
                handlers[i]!({ item, error })
            } catch {
                // Isolate layer handler failures from the pump.
            }
        }
    }

    const subscribeInternalFailed = (
        handler: InternalFailedHandler<T>,
    ): (() => void) => {
        internalHandlers.push(handler)
        internalFailed += 1
        return () => {
            const idx = internalHandlers.indexOf(handler)
            if (idx >= 0) {
                internalHandlers.splice(idx, 1)
                internalFailed -= 1
            }
        }
    }

    const requestPump = (): void => {
        if (pumping) return
        const batch =
            batchRepumpOpt !== undefined
                ? batchRepumpOpt
                : concurrency >= 4
        if (batch) {
            if (pumpScheduled) return
            pumpScheduled = true
            scheduleMicrotask(() => {
                pumpScheduled = false
                pump()
            })
            return
        }
        pump()
    }

    /**
     * Called when an async item's thenable settles (both fulfilled and rejected
     * paths when no completed/failed listeners are subscribed).
     * Stable function reference — avoids two closure allocations per async item
     * on the no-listener fast path.
     *
     * `worker:settled` / re-pump are decided at settle time so late subscribers
     * (e.g. `gracefulStop`) still observe completion.
     */
    const finishAsync = (): void => {
        active -= 1
        if (subs.settled > 0) {
            emitInner('worker:settled', undefined)
        }
        if (!pumping) {
            requestPump()
        }
    }

    /**
     * With one concurrency slot, internal failure layers can share one pair
     * of settle callbacks because there is only one item in flight. This
     * preserves the zero-success-closure path without capturing each item.
     */
    let singleInternalItem: T | undefined
    let singleInternalActive = false

    const completeSingleInternal = (): void => {
        if (!singleInternalActive) return
        singleInternalActive = false
        singleInternalItem = undefined
        if (trackStats) completedCount += 1
        finishAsync()
    }

    const failSingleInternal = (error: unknown): void => {
        if (!singleInternalActive) return
        notifyInternalFailed(singleInternalItem as T, error)
        singleInternalActive = false
        singleInternalItem = undefined
        if (trackStats) failedCount += 1
        finishAsync()
    }

    let abortAttached = false

    const onAbort = (): void => {
        abortAttached = false
        running = false
    }

    const attachAbort = (): void => {
        if (
            options.signal === undefined ||
            options.signal.aborted ||
            abortAttached
        ) {
            return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        abortAttached = true
    }

    const detachAbort = (): void => {
        if (!abortAttached || options.signal === undefined) return
        options.signal.removeEventListener('abort', onAbort)
        abortAttached = false
    }

    const stop = (): void => {
        running = false
        // Drop the listener so discarded workers do not pin a shared signal.
        // start() re-attaches if the signal is still live.
        detachAbort()
    }

    const pump = (): void => {
        if (pumping) return
        pumping = true
        const takeTo = inner.takeTo
        try {
            while (running && active < concurrency) {
                if (!takeTo(takeOut)) break
                const item = takeOut.value
                takeOut.value = undefined as unknown as T

                if (subs.started > 0) {
                    emitInner('worker:started', { item })
                }

                let ret: R | PromiseLike<R>
                try {
                    ret = worker(item)
                } catch (error) {
                    if (trackStats) failedCount += 1
                    notifyInternalFailed(item, error)
                    if (subs.failed > 0) {
                        emitInner('worker:failed', { item, error })
                    }
                    continue
                }

                if (isThenable(ret)) {
                    if (
                        concurrency === 1 &&
                        internalFailed > 0 &&
                        subs.completed === 0 &&
                        subs.failed === 0
                    ) {
                        singleInternalItem = item
                        singleInternalActive = true
                        active += 1
                        try {
                            ret.then(completeSingleInternal, failSingleInternal)
                        } catch (error) {
                            failSingleInternal(error)
                        }
                        continue
                    }

                    active += 1
                    try {
                        // Fast path: no user completed/failed listeners.
                        // Internal failure hooks do not force success-path closures
                        // when stats are off (reuse stable finishAsync on success).
                        if (subs.completed === 0 && subs.failed === 0) {
                            if (internalFailed === 0 && !trackStats) {
                                ret.then(
                                    finishAsync as (value: unknown) => void,
                                    finishAsync,
                                )
                            } else if (internalFailed === 0) {
                                ret.then(
                                    () => {
                                        completedCount += 1
                                        finishAsync()
                                    },
                                    () => {
                                        failedCount += 1
                                        finishAsync()
                                    },
                                )
                            } else {
                                ret.then(
                                    trackStats
                                        ? () => {
                                              completedCount += 1
                                              finishAsync()
                                          }
                                        : (finishAsync as (
                                              value: unknown,
                                          ) => void),
                                    (error: unknown) => {
                                        if (trackStats) failedCount += 1
                                        notifyInternalFailed(item, error)
                                        finishAsync()
                                    },
                                )
                            }
                        } else {
                            ret.then(
                                (result) => {
                                    if (trackStats) completedCount += 1
                                    if (subs.completed > 0) {
                                        emitInner('worker:completed', {
                                            item,
                                            result: result as R,
                                        })
                                    }
                                    finishAsync()
                                },
                                (error: unknown) => {
                                    if (trackStats) failedCount += 1
                                    notifyInternalFailed(item, error)
                                    if (subs.failed > 0) {
                                        emitInner('worker:failed', {
                                            item,
                                            error,
                                        })
                                    }
                                    finishAsync()
                                },
                            )
                        }
                    } catch (error) {
                        if (trackStats) failedCount += 1
                        notifyInternalFailed(item, error)
                        if (subs.failed > 0) {
                            emitInner('worker:failed', { item, error })
                        }
                        finishAsync()
                    }
                } else {
                    if (trackStats) completedCount += 1
                    if (subs.completed > 0) {
                        emitInner('worker:completed', { item, result: ret })
                    }
                }
            }
        } catch (error) {
            if (subs.pumpError > 0) {
                emitInner('worker:pump-error', { error })
            }
            stop()
        } finally {
            pumping = false
        }
        if (subs.idle > 0 && active === 0 && inner.isEmpty()) {
            emitInner('worker:idle', undefined)
        }
    }

    const start = (): void => {
        if (options.signal?.aborted) return
        if (running) return
        attachAbort()
        running = true
        pump()
    }

    const enqueue = (item: T): void => {
        inner.enqueue(item)
        pump()
    }

    const replaceAll = (items: readonly T[]): void => {
        inner.replaceAll(items)
        pump()
    }

    if (autoStart && !options.signal?.aborted) {
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

    const drain = (drainOptions?: DrainOptions): Promise<void> => {
        if (options.signal?.aborted) {
            if (inner.isEmpty() && !isProcessing()) {
                return Promise.resolve()
            }
            const error = new Error(
                'drain cannot complete: worker signal is aborted with remaining work',
            )
            error.name = 'WorkerAbortedError'
            return Promise.reject(error)
        }
        if (!running) {
            start()
        }
        return runDrain(
            {
                isEmpty: () => inner.isEmpty(),
                isProcessing,
                on: on as Parameters<typeof runDrain>[0]['on'],
            },
            drainOptions,
        )
    }

    const setConcurrency = (n: number): void => {
        concurrency = resolveConcurrency(n)
        if (running) pump()
    }

    const baseStats = typeof inner.stats === 'function' ? inner.stats : undefined

    const stats = (): QueueStats => {
        const base = baseStats?.() ?? {
            size: inner.size(),
            enqueued: 0,
            dequeued: 0,
            failed: 0,
            completed: 0,
            active: 0,
        }
        return {
            size: inner.size(),
            enqueued: base.enqueued,
            dequeued: base.dequeued,
            failed: failedCount,
            completed: completedCount,
            active,
        }
    }

    const overrides: Record<string | symbol, unknown> = {
        on,
        enqueue,
        replaceAll,
        start,
        stop,
        gracefulStop,
        drain,
        isRunning: () => running,
        isProcessing,
        activeCount: () => active,
        setConcurrency,
        getConcurrency: () => concurrency,
        [INTERNAL_FAILED_SUBSCRIBE]: subscribeInternalFailed,
    }

    if (trackStats || baseStats !== undefined) {
        overrides.stats = stats
    }

    const api = markQueueLayer(
        decorateQueue(inner, overrides),
        WORKER_LAYER,
    )

    return api as unknown as QueueWithWorker<
        T,
        R,
        WorkerQueueEvents<T, R, TEvents>
    > &
        PreserveQueueExtras<TQueue>
}
