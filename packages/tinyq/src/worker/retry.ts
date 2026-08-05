import type { AbortSignalLike } from '../util/abort-signal.util'
import {
    type DelayPolicy,
    isInvalidStaticDelay,
    resolveDelayMs,
} from '../util/delay-policy.util'
import {
    isIntegerInRange,
    isNonNegativeFinite,
} from '../util/number.util'
import {
    cancelTimeout,
    scheduleTimeout,
} from '../util/schedule-timeout.util'
import type { WorkerFn } from './types'

export type RetryOptions<T = unknown> = {
    /**
     * Total attempts = `retries + 1`.
     * How many times to retry after the first failure.
     * Must be a safe integer ≥ 0.
     */
    retries: number
    /**
     * Delay in ms before each retry. Number or function of the 1-based
     * failed attempt count only. Must resolve to a finite number ≥ 0.
     */
    delay?: DelayPolicy
    /** Return false to stop retrying early. Defaults to always retry. */
    shouldRetry?: (error: unknown, failedAttempt: number) => boolean
    /**
     * Abort signal for the whole retry sequence, or a per-attempt factory.
     * The factory receives the 1-based **attempt** index (before the attempt
     * runs, and again after a failure when computing delay). When aborted,
     * the next wait / attempt is cancelled with the abort reason.
     */
    signal?:
        | AbortSignalLike
        | ((item: T, attempt: number) => AbortSignalLike | undefined)
}

/** Thrown when {@link RetryOptions} values are invalid. */
export class InvalidRetryOptionError extends Error {
    override readonly name = 'InvalidRetryOptionError'

    constructor(message: string) {
        super(message)
    }
}

/** Thrown when all retry attempts are exhausted (or `shouldRetry` returns false). */
export class RetryExhaustedError extends Error {
    override readonly name = 'RetryExhaustedError'
    readonly attempts: number
    override readonly cause: unknown

    constructor(attempts: number, cause: unknown) {
        super(`Retry exhausted after ${attempts} attempt(s)`, { cause })
        this.attempts = attempts
        this.cause = cause
    }
}

/** Thenable check — same surface as `await`. */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    value != null && typeof (value as { then?: unknown }).then === 'function'

const sleep = (ms: number, signal?: AbortSignalLike): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('Aborted'))
            return
        }
        const handle = scheduleTimeout(() => {
            if (signal !== undefined) {
                signal.removeEventListener('abort', onAbort)
            }
            resolve()
        }, ms)
        const onAbort = (): void => {
            cancelTimeout(handle)
            reject(signal?.reason ?? new Error('Aborted'))
        }
        if (signal !== undefined) {
            signal.addEventListener('abort', onAbort, { once: true })
        }
    })

const requireDelayMs = (
    delay: DelayPolicy | undefined,
    attempt: number,
): number => {
    const ms = resolveDelayMs(delay, attempt)
    if (!isNonNegativeFinite(ms)) {
        throw new InvalidRetryOptionError(
            'retry delay must be a finite number >= 0',
        )
    }
    return ms
}

const resolveSignal = <T>(
    signalOpt: RetryOptions<T>['signal'],
    item: T,
    attempt: number,
): AbortSignalLike | undefined => {
    if (signalOpt === undefined) return undefined
    if (typeof signalOpt === 'function') {
        return signalOpt(item, attempt)
    }
    return signalOpt
}

/**
 * Wrap a worker function so failed jobs are retried a fixed number of times.
 * Returns a {@link WorkerFn} for {@link withWorker} (does not wrap a queue).
 *
 * When the wrapped worker returns a non-thenable on the first successful attempt
 * (and no delay waits occurred), the result is returned **synchronously** so
 * the outer worker can stay on its sync path.
 *
 * @example
 * const run = retryWorker(async (job) => callApi(job), { retries: 3, delay: 100 })
 * withWorker(queue, run)
 */
export const retryWorker = <T, R>(
    worker: WorkerFn<T, R>,
    options: RetryOptions<T> | number,
): WorkerFn<T, R> => {
    const opts: RetryOptions<T> =
        typeof options === 'number' ? { retries: options } : options

    if (!isIntegerInRange(opts.retries, 0)) {
        throw new InvalidRetryOptionError(
            'retries must be a safe integer >= 0',
        )
    }

    if (isInvalidStaticDelay(opts.delay)) {
        throw new InvalidRetryOptionError(
            'retry delay must be a finite number >= 0',
        )
    }

    const maxRetries = opts.retries
    const shouldRetry = opts.shouldRetry ?? (() => true)
    const signalOpt = opts.signal

    /** Run attempts starting at `fromAttempt` (1-based). */
    const runFrom = async (item: T, fromAttempt: number): Promise<R> => {
        let lastError: unknown

        for (let attempt = fromAttempt; attempt <= maxRetries + 1; attempt += 1) {
            const sig = resolveSignal(signalOpt, item, attempt)
            if (sig?.aborted) {
                throw sig.reason ?? new Error('Aborted')
            }

            try {
                const ret = worker(item)
                if (isThenable(ret)) {
                    return (await ret) as R
                }
                return ret as R
            } catch (error) {
                lastError = error
                const failedAttempt = attempt
                const retriesLeft = maxRetries + 1 - attempt

                if (retriesLeft <= 0 || !shouldRetry(error, failedAttempt)) {
                    throw new RetryExhaustedError(failedAttempt, error)
                }

                const wait = requireDelayMs(opts.delay, failedAttempt)
                const waitSig = resolveSignal(signalOpt, item, failedAttempt)
                if (wait > 0) {
                    await sleep(wait, waitSig)
                } else if (waitSig?.aborted) {
                    throw waitSig.reason ?? new Error('Aborted')
                }
            }
        }

        throw new RetryExhaustedError(maxRetries + 1, lastError)
    }

    return (item: T): R | Promise<R> => {
        const sig0 = resolveSignal(signalOpt, item, 1)
        if (sig0?.aborted) {
            return Promise.reject(sig0.reason ?? new Error('Aborted'))
        }

        try {
            const ret = worker(item)
            if (isThenable(ret)) {
                return Promise.resolve(ret).catch(
                    async (error: unknown): Promise<R> => {
                        const failedAttempt = 1
                        const retriesLeft = maxRetries
                        if (
                            retriesLeft <= 0 ||
                            !shouldRetry(error, failedAttempt)
                        ) {
                            throw new RetryExhaustedError(failedAttempt, error)
                        }
                        const wait = requireDelayMs(opts.delay, failedAttempt)
                        const sig = resolveSignal(
                            signalOpt,
                            item,
                            failedAttempt,
                        )
                        if (wait > 0) {
                            await sleep(wait, sig)
                        } else if (sig?.aborted) {
                            throw sig.reason ?? new Error('Aborted')
                        }
                        return runFrom(item, 2)
                    },
                ) as Promise<R>
            }
            // Sync success on first attempt — preserve sync return.
            return ret as R
        } catch (error) {
            const failedAttempt = 1
            const retriesLeft = maxRetries
            if (retriesLeft <= 0 || !shouldRetry(error, failedAttempt)) {
                throw new RetryExhaustedError(failedAttempt, error)
            }
            const wait = requireDelayMs(opts.delay, failedAttempt)
            const sig = resolveSignal(signalOpt, item, failedAttempt)
            return (async (): Promise<R> => {
                if (wait > 0) {
                    await sleep(wait, sig)
                } else if (sig?.aborted) {
                    throw sig.reason ?? new Error('Aborted')
                }
                return runFrom(item, 2)
            })()
        }
    }
}
