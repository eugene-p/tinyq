/**
 * Decorator layer brands for composition guards.
 * Uses `Symbol.for` so checks remain valid across duplicate package copies.
 * Symbol keys are already omitted from `Object.keys` / `for…in`.
 */

export const WORKER_LAYER = Symbol.for('tq:worker-layer')
export const DLQ_LAYER = Symbol.for('tq:dlq-layer')
export const LOOP_LAYER = Symbol.for('tq:loop-layer')

type QueueLayerBrand =
    | typeof WORKER_LAYER
    | typeof DLQ_LAYER
    | typeof LOOP_LAYER

/** Known brands to copy across decorator wrappers. */
const QUEUE_LAYERS: readonly QueueLayerBrand[] = [
    WORKER_LAYER,
    DLQ_LAYER,
    LOOP_LAYER,
]

/** Brand a queue decorator object (idempotent). */
export const markQueueLayer = <T extends object>(
    queue: T,
    layer: QueueLayerBrand,
): T => {
    if (hasQueueLayer(queue, layer)) return queue
    ;(queue as Record<symbol, unknown>)[layer] = true
    return queue
}

export const hasQueueLayer = (
    queue: object,
    layer: QueueLayerBrand,
): boolean => (queue as Record<symbol, unknown>)[layer] === true

/** Copy known layer brands from an inner queue onto an outer decorator object. */
export const copyQueueLayers = <T extends object>(
    from: object,
    to: T,
): T => {
    for (let i = 0; i < QUEUE_LAYERS.length; i += 1) {
        const layer = QUEUE_LAYERS[i]!
        if (hasQueueLayer(from, layer)) markQueueLayer(to, layer)
    }
    return to
}
