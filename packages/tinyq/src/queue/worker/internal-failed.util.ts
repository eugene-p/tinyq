/**
 * Internal failure channel for layers (loop/dlq) that must observe failures
 * without forcing the user-facing `worker:failed` slow path on successes.
 */

export type InternalFailedPayload<T = unknown> = {
    item: T
    error: unknown
}

export type InternalFailedHandler<T = unknown> = (
    payload: InternalFailedPayload<T>,
) => void

/** Symbol key on a worker queue for internal failure subscription. */
export const INTERNAL_FAILED_SUBSCRIBE = Symbol.for(
    'tq:internal-failed-subscribe',
)

export type InternalFailedSubscribe = <T>(
    handler: InternalFailedHandler<T>,
) => () => void

/** Subscribe to worker failures without counting as a user `worker:failed` listener. */
export const subscribeInternalFailed = <T>(
    queue: object,
    handler: InternalFailedHandler<T>,
): (() => void) => {
    const subscribe = (queue as Record<symbol, unknown>)[
        INTERNAL_FAILED_SUBSCRIBE
    ] as InternalFailedSubscribe | undefined
    if (typeof subscribe !== 'function') {
        throw new Error(
            'subscribeInternalFailed requires a withWorker queue',
        )
    }
    return subscribe(handler)
}
