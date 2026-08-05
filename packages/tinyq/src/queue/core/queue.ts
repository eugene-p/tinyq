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
    /** Fired when an item is dropped under a non-throw overflow policy. */
    'queue:dropped': {
        item: T
        reason: 'oldest' | 'newest'
        size: number
    }
    /**
     * Fired when size crosses {@link BuildQueueOptions.highWaterMark}
     * (entering or leaving the above-mark region).
     */
    'queue:pressure': {
        size: number
        highWaterMark: number
        above: boolean
    }
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

/**
 * Optional counters when `trackStats` is enabled.
 *
 * `enqueued` / `dequeued` count successful accepted pushes and consumer
 * removals (including `dropOldest` discards and items removed by `clear` /
 * `replaceAll`). They are not a durable audit log; `size` is always
 * authoritative for occupancy.
 */
export type QueueStats = {
    size: number
    enqueued: number
    dequeued: number
    failed: number
    completed: number
    active: number
}

export type Queue<T, TEvents extends EventMap = QueueEvents<T>> = {
    /** Add an item to the tail (FIFO). Behavior at capacity depends on `overflow`. */
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
    /**
     * Counters when {@link BuildQueueOptions.trackStats} is true.
     * Worker layers may fill `failed` / `completed` / `active`.
     */
    stats?: () => QueueStats
    on: EventEmitter<TEvents>['on']
    emit: EventEmitter<TEvents>['emit']
}

/** What happens when {@link BuildQueueOptions.maxSize} is reached. */
export type OverflowPolicy = 'throw' | 'dropOldest' | 'dropNewest'

export type BuildQueueOptions = {
    /**
     * Maximum items allowed in the queue.
     * Must be a safe integer ≥ 1.
     * Default overflow is {@link QueueFullError} on exceed; see `overflow`.
     */
    maxSize?: number
    /**
     * Behavior when enqueue would exceed `maxSize`. Requires `maxSize`.
     * Default: `'throw'`.
     */
    overflow?: OverflowPolicy
    /**
     * Emit `queue:pressure` when size crosses this mark (both directions).
     * Must be a safe integer ≥ 0. No emit cost without `queue:pressure`
     * listeners; a small boolean is still updated when the option is set.
     */
    highWaterMark?: number
    /**
     * When true, expose {@link Queue.stats} with integer counters.
     * Default: false (zero hot-path cost when off).
     */
    trackStats?: boolean
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

/** Power-of-two interval for requesting head-indexed compaction checks. */
const COMPACT_HEAD_MIN = 1024

/**
 * Largest `maxSize` for the ring path. Capacity is the next power of two and
 * indexing uses 32-bit `& mask`, so capacity must stay ≤ 2^31.
 */
const MAX_RING_MAX_SIZE = 2 ** 31

/** Smallest power of two ≥ n. Requires 1 ≤ n ≤ 2^31. */
const nextPowerOfTwo = (n: number): number => {
    if (n <= 1) return 1
    // Float path avoids ToInt32 bit-ops (broken for n > 2^31).
    return 2 ** Math.ceil(Math.log2(n))
}

type QueueSubs = {
    enqueued: number
    dequeued: number
    emptied: number
    cleared: number
    dropped: number
    pressure: number
}

const EVENT_SLOT: Record<string, keyof QueueSubs> = {
    'queue:enqueued': 'enqueued',
    'queue:dequeued': 'dequeued',
    'queue:emptied': 'emptied',
    'queue:cleared': 'cleared',
    'queue:dropped': 'dropped',
    'queue:pressure': 'pressure',
}

const resolveName = (raw: string | undefined): string | undefined => {
    if (raw === undefined) return undefined
    const trimmed = raw.trim()
    if (trimmed === '') {
        throw new InvalidQueueOptionError('name must be a non-empty string')
    }
    return trimmed
}

/**
 * In-memory FIFO queue.
 *
 * Unbounded: head-indexed array with compaction when the head hole grows.
 * Bounded (`maxSize`): fixed power-of-two ring buffer (mask indexing).
 *
 * The event emitter is created on the first {@link Queue.on}; until then
 * mutators use a branch-free bare path (no event counters).
 */
export const buildQueue = <T>(options: BuildQueueOptions = {}): Queue<T> => {
    const maxSize = options.maxSize
    if (maxSize !== undefined && !isIntegerInRange(maxSize, 1)) {
        throw new InvalidQueueOptionError('maxSize must be a safe integer >= 1')
    }
    if (maxSize !== undefined && maxSize > MAX_RING_MAX_SIZE) {
        throw new InvalidQueueOptionError(
            `maxSize must be <= ${MAX_RING_MAX_SIZE} (ring buffer limit)`,
        )
    }

    const overflow = options.overflow ?? 'throw'
    if (
        overflow !== 'throw' &&
        overflow !== 'dropOldest' &&
        overflow !== 'dropNewest'
    ) {
        throw new InvalidQueueOptionError(
            'overflow must be "throw", "dropOldest", or "dropNewest"',
        )
    }
    if (options.overflow !== undefined && maxSize === undefined) {
        throw new InvalidQueueOptionError(
            'overflow requires maxSize to be set',
        )
    }

    const highWaterMark = options.highWaterMark
    if (
        highWaterMark !== undefined &&
        !isIntegerInRange(highWaterMark, 0)
    ) {
        throw new InvalidQueueOptionError(
            'highWaterMark must be a safe integer >= 0',
        )
    }

    const trackStats = options.trackStats === true
    const name = resolveName(options.name)

    if (maxSize !== undefined) {
        return markQueueName(
            buildRingQueue<T>({
                maxSize,
                overflow,
                highWaterMark,
                trackStats,
            }),
            name,
        )
    }

    return markQueueName(
        buildHeadIndexedQueue<T>({
            highWaterMark,
            trackStats,
        }),
        name,
    )
}

// ---------------------------------------------------------------------------
// Head-indexed (unbounded)
// ---------------------------------------------------------------------------

type HeadIndexedOpts = {
    highWaterMark?: number
    trackStats: boolean
}

const buildHeadIndexedQueue = <T>(opts: HeadIndexedOpts): Queue<T> => {
    const { highWaterMark, trackStats } = opts

    let items: T[] = []
    let head = 0
    let enqueuedCount = 0
    let dequeuedCount = 0
    let aboveHighWater = false

    let emitter: EventEmitter<QueueEvents<T>> | undefined
    let subs: QueueSubs | undefined
    let compactOnNextEnqueue = false

    const liveSize = (): number => items.length - head

    /** Assumes the queue is non-empty. */
    const removeHead = (): T => {
        const value = items[head] as T
        items[head] = undefined as T
        head += 1
        if (head === items.length) {
            items = []
            head = 0
        } else if ((head & (COMPACT_HEAD_MIN - 1)) === 0) {
            compactOnNextEnqueue = true
        }
        return value
    }

    const checkPressure = (size: number): void => {
        if (highWaterMark === undefined || subs === undefined) return
        if (subs.pressure === 0) {
            aboveHighWater = size > highWaterMark
            return
        }
        const above = size > highWaterMark
        if (above !== aboveHighWater) {
            aboveHighWater = above
            emitter!.emit('queue:pressure', {
                size,
                highWaterMark,
                above,
            })
        }
    }

    const emitAfterDequeue = (value: T): void => {
        const size = liveSize()
        if (subs!.dequeued > 0) {
            emitter!.emit('queue:dequeued', { item: value, size })
        }
        if (size === 0 && subs!.emptied > 0) {
            emitter!.emit('queue:emptied', undefined)
        }
        checkPressure(size)
    }

    const pushItem: (item: T) => void = trackStats
        ? (item): void => {
              items.push(item)
              enqueuedCount += 1
          }
        : (item): void => {
              items.push(item)
          }

    const compactBeforeEnqueue = (): void => {
        compactOnNextEnqueue = false
        const live = liveSize()
        if (head >= COMPACT_HEAD_MIN && head >= live) {
            items = items.slice(head)
            head = 0
        }
    }

    const enqueueBare: (item: T) => void =
        highWaterMark === undefined
            ? (item): void => {
                  if (compactOnNextEnqueue) compactBeforeEnqueue()
                  pushItem(item)
              }
            : (item): void => {
                  if (compactOnNextEnqueue) compactBeforeEnqueue()
                  pushItem(item)
                  const above = liveSize() > highWaterMark
                  if (above !== aboveHighWater) aboveHighWater = above
              }

    const afterBareDequeue = (): void => {
        if (trackStats) dequeuedCount += 1
        if (highWaterMark !== undefined) {
            const above = liveSize() > highWaterMark
            if (above !== aboveHighWater) aboveHighWater = above
        }
    }

    const plain = !trackStats && highWaterMark === undefined

    const takeToBare: (out: { value: T }) => boolean = plain
        ? (out): boolean => {
              if (head === items.length) return false
              out.value = removeHead()
              return true
          }
        : (out): boolean => {
              if (head === items.length) return false
              out.value = removeHead()
              afterBareDequeue()
              return true
          }

    const dequeueBare: () => T | undefined = plain
        ? (): T | undefined => {
              if (head === items.length) return undefined
              return removeHead()
          }
        : (): T | undefined => {
              if (head === items.length) return undefined
              const value = removeHead()
              afterBareDequeue()
              return value
          }

    const tryDequeueBare: () => QueueSlot<T> | undefined = plain
        ? (): QueueSlot<T> | undefined => {
              if (head === items.length) return undefined
              return { value: removeHead() }
          }
        : (): QueueSlot<T> | undefined => {
              if (head === items.length) return undefined
              const value = removeHead()
              afterBareDequeue()
              return { value }
          }

    const clearBare = (): void => {
        if (head === items.length) return
        if (trackStats) dequeuedCount += liveSize()
        items = []
        head = 0
        aboveHighWater = false
    }

    const enqueueLoud = (item: T): void => {
        if (compactOnNextEnqueue) compactBeforeEnqueue()
        pushItem(item)
        const size = liveSize()
        if (subs!.enqueued > 0) {
            emitter!.emit('queue:enqueued', { item, size })
        }
        checkPressure(size)
    }

    const takeToLoud = (out: { value: T }): boolean => {
        if (head === items.length) return false
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        out.value = value
        emitAfterDequeue(value)
        return true
    }

    const dequeueLoud = (): T | undefined => {
        if (head === items.length) return undefined
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        emitAfterDequeue(value)
        return value
    }

    const tryDequeueLoud = (): QueueSlot<T> | undefined => {
        if (head === items.length) return undefined
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        emitAfterDequeue(value)
        return { value }
    }

    const clearLoud = (): void => {
        if (head === items.length) return
        const removed = liveSize()
        if (trackStats) dequeuedCount += removed
        items = []
        head = 0
        if (subs!.cleared > 0) {
            emitter!.emit('queue:cleared', { removed })
        }
        checkPressure(liveSize())
    }

    const tryPeek = (): QueueSlot<T> | undefined => {
        if (head === items.length) return undefined
        return { value: items[head]! }
    }

    const peek = (): T | undefined => {
        if (head === items.length) return undefined
        return items[head]
    }

    const size = (): number => liveSize()
    const isEmpty = (): boolean => head === items.length

    const replaceAll = (next: readonly T[]): void => {
        if (trackStats) {
            dequeuedCount += liveSize()
            enqueuedCount += next.length
        }
        items = next.length === 0 ? [] : next.slice()
        head = 0
        if (highWaterMark !== undefined) {
            aboveHighWater = liveSize() > highWaterMark
        }
    }

    const toArray = (): T[] =>
        head === items.length ? [] : items.slice(head)

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

    if (trackStats) {
        api.stats = (): QueueStats => ({
            size: liveSize(),
            enqueued: enqueuedCount,
            dequeued: dequeuedCount,
            failed: 0,
            completed: 0,
            active: 0,
        })
    }

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
        subs = {
            enqueued: 0,
            dequeued: 0,
            emptied: 0,
            cleared: 0,
            dropped: 0,
            pressure: 0,
        }
        return emitter
    }

    api.on = (eventName, callback) => {
        const em = ensureEmitter()
        const unsub = em.on(eventName, callback)
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

    return api
}

// ---------------------------------------------------------------------------
// Ring buffer (bounded maxSize)
// ---------------------------------------------------------------------------

type RingOpts = {
    maxSize: number
    overflow: OverflowPolicy
    highWaterMark?: number
    trackStats: boolean
}

const buildRingQueue = <T>(opts: RingOpts): Queue<T> => {
    const { maxSize, overflow, highWaterMark, trackStats } = opts
    const capacity = nextPowerOfTwo(maxSize)
    const mask = capacity - 1

    let buf: (T | undefined)[] = new Array(capacity)
    let head = 0
    let tail = 0
    let count = 0
    let enqueuedCount = 0
    let dequeuedCount = 0
    let aboveHighWater = false

    let emitter: EventEmitter<QueueEvents<T>> | undefined
    let subs: QueueSubs | undefined

    const removeHead = (): T => {
        const value = buf[head] as T
        buf[head] = undefined
        head = (head + 1) & mask
        count -= 1
        return value
    }

    const pushTail = (item: T): void => {
        buf[tail] = item
        tail = (tail + 1) & mask
        count += 1
        if (trackStats) enqueuedCount += 1
    }

    const checkPressure = (size: number): void => {
        if (highWaterMark === undefined || subs === undefined) return
        if (subs.pressure === 0) {
            aboveHighWater = size > highWaterMark
            return
        }
        const above = size > highWaterMark
        if (above !== aboveHighWater) {
            aboveHighWater = above
            emitter!.emit('queue:pressure', {
                size,
                highWaterMark,
                above,
            })
        }
    }

    const trackPressureBare = (): void => {
        if (highWaterMark === undefined) return
        aboveHighWater = count > highWaterMark
    }

    const emitAfterDequeue = (value: T): void => {
        if (subs!.dequeued > 0) {
            emitter!.emit('queue:dequeued', { item: value, size: count })
        }
        if (count === 0 && subs!.emptied > 0) {
            emitter!.emit('queue:emptied', undefined)
        }
        checkPressure(count)
    }

    const emitDropped = (item: T, reason: 'oldest' | 'newest'): void => {
        if (subs !== undefined && subs.dropped > 0) {
            emitter!.emit('queue:dropped', { item, reason, size: count })
        }
    }

    const enqueueAtCapacity = (item: T, loud: boolean): void => {
        if (overflow === 'throw') {
            throw new QueueFullError(maxSize)
        }
        if (overflow === 'dropNewest') {
            if (loud) emitDropped(item, 'newest')
            return
        }
        // dropOldest — count discard as a consumer removal so
        // enqueued - dequeued stays aligned with size.
        const dropped = removeHead()
        if (trackStats) dequeuedCount += 1
        pushTail(item)
        if (loud) emitDropped(dropped, 'oldest')
        if (loud && subs!.enqueued > 0) {
            emitter!.emit('queue:enqueued', { item, size: count })
        }
        if (loud) checkPressure(count)
        else trackPressureBare()
    }

    const enqueueBare = (item: T): void => {
        if (count >= maxSize) {
            enqueueAtCapacity(item, false)
            return
        }
        pushTail(item)
        trackPressureBare()
    }

    const takeToBare = (out: { value: T }): boolean => {
        if (count === 0) return false
        out.value = removeHead()
        if (trackStats) dequeuedCount += 1
        trackPressureBare()
        return true
    }

    const dequeueBare = (): T | undefined => {
        if (count === 0) return undefined
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        trackPressureBare()
        return value
    }

    const tryDequeueBare = (): QueueSlot<T> | undefined => {
        if (count === 0) return undefined
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        trackPressureBare()
        return { value }
    }

    const clearBare = (): void => {
        if (count === 0) return
        if (trackStats) dequeuedCount += count
        buf = new Array(capacity)
        head = 0
        tail = 0
        count = 0
        aboveHighWater = false
    }

    const enqueueLoud = (item: T): void => {
        if (count >= maxSize) {
            enqueueAtCapacity(item, true)
            return
        }
        pushTail(item)
        if (subs!.enqueued > 0) {
            emitter!.emit('queue:enqueued', { item, size: count })
        }
        checkPressure(count)
    }

    const takeToLoud = (out: { value: T }): boolean => {
        if (count === 0) return false
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        out.value = value
        emitAfterDequeue(value)
        return true
    }

    const dequeueLoud = (): T | undefined => {
        if (count === 0) return undefined
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        emitAfterDequeue(value)
        return value
    }

    const tryDequeueLoud = (): QueueSlot<T> | undefined => {
        if (count === 0) return undefined
        const value = removeHead()
        if (trackStats) dequeuedCount += 1
        emitAfterDequeue(value)
        return { value }
    }

    const clearLoud = (): void => {
        if (count === 0) return
        const removed = count
        if (trackStats) dequeuedCount += removed
        buf = new Array(capacity)
        head = 0
        tail = 0
        count = 0
        if (subs!.cleared > 0) {
            emitter!.emit('queue:cleared', { removed })
        }
        checkPressure(count)
    }

    const tryPeek = (): QueueSlot<T> | undefined => {
        if (count === 0) return undefined
        return { value: buf[head] as T }
    }

    const peek = (): T | undefined => {
        if (count === 0) return undefined
        return buf[head]
    }

    const size = (): number => count
    const isEmpty = (): boolean => count === 0

    const replaceAll = (next: readonly T[]): void => {
        if (next.length > maxSize) {
            throw new QueueFullError(maxSize)
        }
        if (trackStats) {
            dequeuedCount += count
            enqueuedCount += next.length
        }
        buf = new Array(capacity)
        head = 0
        tail = 0
        count = 0
        for (let i = 0; i < next.length; i += 1) {
            buf[tail] = next[i]
            tail = (tail + 1) & mask
            count += 1
        }
        if (highWaterMark !== undefined) {
            aboveHighWater = count > highWaterMark
        }
    }

    const toArray = (): T[] => {
        if (count === 0) return []
        const out = new Array<T>(count)
        for (let i = 0; i < count; i += 1) {
            out[i] = buf[(head + i) & mask] as T
        }
        return out
    }

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

    if (trackStats) {
        api.stats = (): QueueStats => ({
            size: count,
            enqueued: enqueuedCount,
            dequeued: dequeuedCount,
            failed: 0,
            completed: 0,
            active: 0,
        })
    }

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
        subs = {
            enqueued: 0,
            dequeued: 0,
            emptied: 0,
            cleared: 0,
            dropped: 0,
            pressure: 0,
        }
        return emitter
    }

    api.on = (eventName, callback) => {
        const em = ensureEmitter()
        const unsub = em.on(eventName, callback)
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

    return api
}
