/** Reserved top-level key for library-owned bookkeeping on payloads. */
export const TQ_KEY = '__tq' as const

/** True for plain objects (`{}` / Object.create(null)), not arrays, Date, class instances. */
export const isPlainObject = (
    value: unknown,
): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object') return false
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

/**
 * Read hop count for a logical queue key.
 * Shape: `item.__tq.loop[name].hops`.
 */
export const getLoopHops = (
    item: unknown,
    name: string,
): number | undefined => {
    if (!isPlainObject(item)) return undefined
    const root = item[TQ_KEY]
    if (!isPlainObject(root)) return undefined
    const loop = root.loop
    if (!isPlainObject(loop)) return undefined
    const entry = loop[name]
    if (!isPlainObject(entry)) return undefined
    const hops = entry.hops
    return typeof hops === 'number' && Number.isFinite(hops) ? hops : undefined
}

/**
 * Structural compare for reserved meta bags (plain objects + leaf primitives).
 * Walks own keys without `JSON.stringify` (hot path on every loop failure).
 */
export const queueMetaEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a === undefined || b === undefined) return a === b
    if (!isPlainObject(a) || !isPlainObject(b)) return false

    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false

    for (let i = 0; i < aKeys.length; i += 1) {
        const key = aKeys[i]!
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false
        const av = a[key]
        const bv = b[key]
        if (av === bv) continue
        if (isPlainObject(av) && isPlainObject(bv)) {
            if (!queueMetaEqual(av, bv)) return false
            continue
        }
        if (av !== bv) return false
    }
    return true
}

/**
 * Build library-owned `__tq` root with incremented hop for `name`,
 * preserving sibling keys under the root and under `loop`.
 */
export const buildLoopQueueMeta = (
    original: unknown,
    name: string,
    hops: number,
): Record<string, unknown> => {
    const prevRoot =
        isPlainObject(original) && isPlainObject(original[TQ_KEY])
            ? (original[TQ_KEY] as Record<string, unknown>)
            : {}
    const prevLoop = isPlainObject(prevRoot.loop)
        ? (prevRoot.loop as Record<string, unknown>)
        : {}
    const prevEntry = isPlainObject(prevLoop[name])
        ? (prevLoop[name] as Record<string, unknown>)
        : {}

    return {
        ...prevRoot,
        loop: {
            ...prevLoop,
            [name]: {
                ...prevEntry,
                hops,
            },
        },
    }
}

/**
 * Apply library hop stamp onto a user (or identity) map result.
 * Always overwrites {@link TQ_KEY} with {@link buildLoopQueueMeta}
 * computed from the **original** failed item.
 */
export const stampLoopHops = <T>(
    mapped: unknown,
    original: T,
    name: string,
    hops: number,
): unknown => {
    const libraryRoot = buildLoopQueueMeta(original, name, hops)

    if (!isPlainObject(mapped)) {
        return {
            value: mapped,
            [TQ_KEY]: libraryRoot,
        }
    }

    // Overwrite only — avoid `delete` (keeps a fast V8 object shape).
    return {
        ...mapped,
        [TQ_KEY]: libraryRoot,
    }
}

/** Own-property reserved bag on a plain mapped result, if any. */
export const readMappedQueueMeta = (mapped: unknown): unknown => {
    if (!isPlainObject(mapped)) return undefined
    if (!Object.prototype.hasOwnProperty.call(mapped, TQ_KEY)) {
        return undefined
    }
    return mapped[TQ_KEY]
}
