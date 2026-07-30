import {
    buildEventEmitter,
    type EventEmitter,
    type EventMap,
} from '../../events'
import { isIntegerInRange } from '../../util/number.util'
import { markQueueName } from './queue-name.util'

export type QueueEvents<T> = {
    /** Fired after an item is added to the tail. */
    'queue:enqueued': { item: T; size: number }
    /** Fired after an item is removed from the head. */
    'queue:dequeued': { item: T; size: number }
    /** Fired when the last item is dequeued (queue becomes empty). */
    'queue:emptied': undefined
    /** Fired after clear() removes all items. */
    'queue:cleared': { removed: number }
}

/**
 * Envelope for an occupied queue slot.
 *
 * Presence of the object means “there was an item”; {@link value} is the
 * payload and may be `null` or `undefined`. Emptiness is structural
 * (`undefined` return from {@link Queue.tryDequeue} / {@link Queue.tryPeek}),
 * never inferred from the payload.
 */
export type QueueSlot<T> = {
    readonly value: T
}

export type Queue<T, TEvents extends EventMap = QueueEvents<T>> = {
    /** Add an item to the tail (FIFO). Throws {@link QueueFullError} when at `maxSize`. */
    enqueue: (item: T) => void
    /**
     * Remove and return the head item, or `undefined` if empty.
     *
     * When `T` may be `null`/`undefined`, prefer {@link tryDequeue}: a bare
     * `undefined` return cannot distinguish “empty” from “payload was undefined”.
     */
    dequeue: () => T | undefined
    /**
     * Return the head item without removing it, or `undefined` if empty.
     *
     * When `T` may be `null`/`undefined`, prefer {@link tryPeek}.
     */
    peek: () => T | undefined
    /**
     * Remove the head and return it in a {@link QueueSlot}, or `undefined` if
     * the queue was empty. Nullish payloads are valid (`{ value: undefined }`).
     *
     * Decorators that override {@link dequeue} must override this too so side
     * effects stay aligned.
     */
    tryDequeue: () => QueueSlot<T> | undefined
    /**
     * Peek the head in a {@link QueueSlot}, or `undefined` if empty.
     * Nullish payloads are valid (`{ value: undefined }`).
     *
     * Decorators that override {@link peek} must override this too when they
     * transform the payload (e.g. row unwrap).
     */
    tryPeek: () => QueueSlot<T> | undefined
    /**
     * Remove the head into `out.value` when the queue is non-empty.
     * Returns `true` if an item was taken. Nullish payloads are valid.
     *
     * Hot-path alternative to {@link isEmpty} + {@link dequeue} (one emptiness
     * check, no {@link QueueSlot} allocation). Decorators that override
     * {@link dequeue} must override this too so side effects stay aligned.
     */
    takeTo: (out: { value: T }) => boolean
    /** Current number of items. */
    size: () => number
    /** Whether the queue has no items. */
    isEmpty: () => boolean
    /** Remove all items and emit `queue:cleared`. */
    clear: () => void
    /**
     * Replace all items without emitting queue events.
     * Not a substitute for looping `enqueue` — no `queue:enqueued` events fire.
     * Throws {@link QueueFullError} when `items.length` exceeds `maxSize`.
     */
    replaceAll: (items: readonly T[]) => void
    /** Snapshot of items from head to tail (does not mutate). */
    toArray: () => T[]
    on: EventEmitter<TEvents>['on']
    emit: EventEmitter<TEvents>['emit']
}

export type BuildQueueOptions = {
    /**
     * Maximum items allowed in the queue.
     * Must be a safe integer ≥ 1.
     * `enqueue` / `replaceAll` throw {@link QueueFullError} when exceeded.
     */
    maxSize?: number
    /**
     * Logical queue id for hop meta, tracking, and layers that require identity
     * (e.g. {@link import('../loop/with-loop').withLoop}).
     * Trimmed; must be non-empty when provided. Read with {@link import('./queue-name.util').getQueueName}.
     */
    name?: string
}

/** Thrown when enqueue/replaceAll would exceed {@link BuildQueueOptions.maxSize}. */
export class QueueFullError extends Error {
    override readonly name = 'QueueFullError'
    readonly maxSize: number

    constructor(maxSize: number) {
        super(`Queue is full (maxSize=${maxSize})`)
        this.maxSize = maxSize
    }
}

/** Thrown when {@link BuildQueueOptions} values are invalid. */
export class InvalidQueueOptionError extends Error {
    override readonly name = 'InvalidQueueOptionError'

    constructor(message: string) {
        super(message)
    }
}

type QueueSubs = {
    enqueued: number
    dequeued: number
    emptied: number
    cleared: number
}

const EVENT_SLOT: Record<string, keyof QueueSubs> = {
    'queue:enqueued': 'enqueued',
    'queue:dequeued': 'dequeued',
    'queue:emptied': 'emptied',
    'queue:cleared': 'cleared',
}

/**
 * In-memory FIFO queue.
 *
 * Head-indexed storage (O(1) amortised enqueue/dequeue). Methods are closures so
 * {@link import('./forward.util').decorateQueue} can prototype-delegate without
 * rebinding `this`. The event emitter is created on the first {@link Queue.on};
 * until then mutators use a branch-free bare path (no event counters).
 */
export const buildQueue = <T>(options: BuildQueueOptions = {}): Queue<T> => {
    const maxSize = options.maxSize
    if (maxSize !== undefined && !isIntegerInRange(maxSize, 1)) {
        throw new InvalidQueueOptionError('maxSize must be a safe integer >= 1')
    }

    let name: string | undefined
    if (options.name !== undefined) {
        const trimmed = options.name.trim()
        if (trimmed === '') {
            throw new InvalidQueueOptionError(
                'name must be a non-empty string',
            )
        }
        name = trimmed
    }

    // Head-indexed FIFO: avoids the full-array reverse required by two stacks.
    // Dequeued slots are cleared immediately so a long-lived queue does not
    // retain processed payloads.
    let items: T[] = []
    let head = 0

    // Lazy events: no emitter until the first subscriber; mutators start bare.
    let emitter: EventEmitter<QueueEvents<T>> | undefined
    let subs: QueueSubs | undefined

    /** Assumes the queue is non-empty. */
    const removeHead = (): T => {
        const value = items[head] as T
        items[head] = undefined as T
        head += 1
        if (head === items.length) {
            // Drop all payload references and make the next producer batch packed.
            items = []
            head = 0
        }
        return value
    }

    // --- bare mutators (no event branches) ---

    const enqueueBare: (item: T) => void =
        maxSize === undefined
            ? (item: T): void => {
                  items.push(item)
              }
            : (item: T): void => {
                  if (items.length - head >= maxSize) {
                      throw new QueueFullError(maxSize)
                  }
                  items.push(item)
              }

    const takeToBare = (out: { value: T }): boolean => {
        if (head === items.length) return false
        out.value = removeHead()
        return true
    }

    const dequeueBare = (): T | undefined => {
        if (head === items.length) return undefined
        return removeHead()
    }

    const tryDequeueBare = (): QueueSlot<T> | undefined => {
        if (head === items.length) return undefined
        return { value: removeHead() }
    }

    const clearBare = (): void => {
        if (head === items.length) return
        items = []
        head = 0
    }

    // --- event-aware mutators (installed on first `on`) ---

    const emitAfterDequeue = (value: T): void => {
        if (subs!.dequeued > 0) {
            emitter!.emit('queue:dequeued', {
                item: value,
                size: items.length - head,
            })
        }
        if (head === items.length && subs!.emptied > 0) {
            emitter!.emit('queue:emptied', undefined)
        }
    }

    const enqueueLoud: (item: T) => void =
        maxSize === undefined
            ? (item: T): void => {
                  items.push(item)
                  if (subs!.enqueued > 0) {
                      emitter!.emit('queue:enqueued', {
                          item,
                          size: items.length - head,
                      })
                  }
              }
            : (item: T): void => {
                  if (items.length - head >= maxSize) {
                      throw new QueueFullError(maxSize)
                  }
                  items.push(item)
                  if (subs!.enqueued > 0) {
                      emitter!.emit('queue:enqueued', {
                          item,
                          size: items.length - head,
                      })
                  }
              }

    const takeToLoud = (out: { value: T }): boolean => {
        if (head === items.length) return false
        const value = removeHead()
        out.value = value
        emitAfterDequeue(value)
        return true
    }

    const dequeueLoud = (): T | undefined => {
        if (head === items.length) return undefined
        const value = removeHead()
        emitAfterDequeue(value)
        return value
    }

    const tryDequeueLoud = (): QueueSlot<T> | undefined => {
        if (head === items.length) return undefined
        const value = removeHead()
        emitAfterDequeue(value)
        return { value }
    }

    const clearLoud = (): void => {
        if (head === items.length) return
        const removed = items.length - head
        items = []
        head = 0
        if (subs!.cleared > 0) {
            emitter!.emit('queue:cleared', { removed })
        }
    }

    const tryPeek = (): QueueSlot<T> | undefined => {
        if (head === items.length) return undefined
        return { value: items[head]! }
    }

    const peek = (): T | undefined => {
        if (head === items.length) return undefined
        return items[head]
    }

    const size = (): number => items.length - head

    const isEmpty = (): boolean => head === items.length

    const replaceAll = (next: readonly T[]): void => {
        if (maxSize !== undefined && next.length > maxSize) {
            throw new QueueFullError(maxSize)
        }
        items = next.length === 0 ? [] : next.slice()
        head = 0
    }

    const toArray = (): T[] => {
        return head === items.length ? [] : items.slice(head)
    }

    // Built before `on`/`emit` so first-subscribe can swap bare mutators in place.
    const api = {
        enqueue: enqueueBare,
        dequeue: dequeueBare,
        peek,
        tryDequeue: tryDequeueBare,
        tryPeek,
        takeTo: takeToBare,
        size,
        isEmpty,
        clear: clearBare,
        replaceAll,
        toArray,
    } as Queue<T>

    /** Swap bare mutators for loud ones; skip slots the user already replaced. */
    const installEventMutators = (): void => {
        if (api.enqueue === enqueueBare) api.enqueue = enqueueLoud
        if (api.dequeue === dequeueBare) api.dequeue = dequeueLoud
        if (api.tryDequeue === tryDequeueBare) api.tryDequeue = tryDequeueLoud
        if (api.takeTo === takeToBare) api.takeTo = takeToLoud
        if (api.clear === clearBare) api.clear = clearLoud
    }

    const ensureEmitter = (): EventEmitter<QueueEvents<T>> => {
        if (emitter !== undefined) return emitter
        emitter = buildEventEmitter<QueueEvents<T>>()
        subs = { enqueued: 0, dequeued: 0, emptied: 0, cleared: 0 }
        return emitter
    }

    api.on = (eventName, callback) => {
        const em = ensureEmitter()
        const unsub = em.on(eventName, callback)
        // Only queue:* subscriptions need event-aware mutators. Worker/layer
        // events share this emitter but must not tax bare enqueue/takeTo.
        const slot = EVENT_SLOT[eventName as string]
        if (slot !== undefined && subs !== undefined) {
            installEventMutators()
            subs[slot] += 1
            return () => {
                unsub()
                if (subs !== undefined) subs[slot] -= 1
            }
        }
        return unsub
    }

    api.emit = (eventName, data) => {
        emitter?.emit(eventName, data)
    }

    return markQueueName(api, name)
}
