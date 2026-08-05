import {
    buildEventEmitter,
    type EventEmitter,
    type EventMap,
} from '../events'

const TOPIC_SEPARATOR = '.'
const SINGLE_WILDCARD = '*'
const MULTI_WILDCARD = '#'
const EMPTY_PARTS: readonly string[] = []

/** A concrete topic and its published payload. */
export type TopicMessage<T = unknown> = {
    topic: string
    data: T
}

/** The minimal surface a topic router needs from a destination. */
export type TopicTarget<T = unknown> = {
    enqueue: (message: TopicMessage<T>) => void
}

export type TopicBinding<T = unknown> = {
    pattern: string
    target: TopicTarget<T>
}

/** Most recent publish that did not match a binding. */
export type UnmatchedTopic = {
    topic: string
    data: unknown
}

export type BuildTopicRouterOptions = {
    /** Optional destination for publishes that match no binding. */
    unmatchedTarget?: TopicTarget
    /**
     * When false, skip retaining {@link TopicRouter.lastUnmatched}.
     * `unmatchedCount` still increments. Default: true.
     */
    trackUnmatched?: boolean
}

export type TopicRouterEvents = {
    'router:bound': { pattern: string }
    'router:unbound': { pattern: string; removed: number }
    'router:cleared': { removed: number }
    'router:published': { topic: string; data: unknown; matched: number }
    'router:unmatched': { topic: string; data: unknown; delivered: boolean }
    'router:error': {
        operation: 'publish' | 'bind' | 'unmatched'
        error: unknown
        topic?: string
        pattern?: string
    }
}

/** Thrown when a topic pattern has invalid wildcard syntax. */
export class InvalidTopicPatternError extends Error {
    override readonly name = 'InvalidTopicPatternError'
    readonly pattern: string

    constructor(pattern: string) {
        super(`Invalid topic pattern: ${pattern}`)
        this.pattern = pattern
    }
}

/** Thrown when a published topic is empty or contains wildcards. */
export class InvalidTopicError extends Error {
    override readonly name = 'InvalidTopicError'
    readonly topic: string

    constructor(topic: string) {
        super(`Invalid topic: ${topic}`)
        this.topic = topic
    }
}

export type TopicRouter<TEvents extends EventMap = TopicRouterEvents> = {
    /** Bind a queue, or any enqueue target, to a dotted topic pattern. */
    bind: <T = unknown>(
        pattern: string,
        target: TopicTarget<T>,
    ) => () => void
    /** Remove one binding, or every binding for a pattern when target is omitted. */
    unbind: <T = unknown>(pattern: string, target?: TopicTarget<T>) => void
    /** Publish to every matching target and return the number of matched bindings. */
    publish: <T = unknown>(topic: string, data: T) => number
    /** Snapshot of current bindings. */
    bindings: () => TopicBinding[]
    /** Remove all bindings. */
    clear: () => void
    setUnmatchedTarget: (target: TopicTarget | undefined) => void
    getUnmatchedTarget: () => TopicTarget | undefined
    unmatchedCount: () => number
    lastUnmatched: () => UnmatchedTopic | undefined
    clearUnmatched: () => void
    on: EventEmitter<TEvents>['on']
    emit: EventEmitter<TEvents>['emit']
}

type InternalBinding = TopicBinding & {
    readonly patternParts: readonly string[]
    readonly hasWildcard: boolean
}

/** Validate a concrete topic without allocating a split-parts array. */
const isValidTopic = (topic: string): boolean => {
    if (topic.length === 0) return false

    let previousWasSeparator = true
    for (let i = 0; i < topic.length; i += 1) {
        const code = topic.charCodeAt(i)
        if (code === 42 || code === 35) return false // * or #
        if (code === 46) {
            if (previousWasSeparator) return false
            previousWasSeparator = true
        } else {
            previousWasSeparator = false
        }
    }
    return !previousWasSeparator
}

const isValidPattern = (pattern: string): boolean => {
    if (pattern.length === 0) return false
    const parts = pattern.split(TOPIC_SEPARATOR)

    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!
        if (part.length === 0) return false
        if (part === MULTI_WILDCARD) return i === parts.length - 1
        if (part === SINGLE_WILDCARD) continue
        if (part.includes(SINGLE_WILDCARD) || part.includes(MULTI_WILDCARD)) {
            return false
        }
    }

    return true
}

const matches = (
    patternParts: readonly string[],
    topicParts: readonly string[],
): boolean => {
    let patternIndex = 0
    let topicIndex = 0

    while (patternIndex < patternParts.length && topicIndex < topicParts.length) {
        const part = patternParts[patternIndex]!
        if (part === MULTI_WILDCARD) return true
        if (part !== SINGLE_WILDCARD && part !== topicParts[topicIndex]) {
            return false
        }
        patternIndex += 1
        topicIndex += 1
    }

    return (
        (patternIndex === patternParts.length - 1 &&
            patternParts[patternIndex] === MULTI_WILDCARD) ||
        (patternIndex === patternParts.length && topicIndex === topicParts.length)
    )
}

/**
 * Publish dotted topics into one or more queue-like targets.
 *
 * Patterns support exact segments, `*` for one segment, and trailing `#` for
 * zero or more segments: `orders.created`, `orders.*`, `orders.#`.
 */
export const buildTopicRouter = (
    options: BuildTopicRouterOptions = {},
): TopicRouter => {
    const routes: InternalBinding[] = []
    let routeVersion = 0
    let unmatchedTarget = options.unmatchedTarget
    const trackUnmatched = options.trackUnmatched !== false
    let unmatchedTotal = 0
    let lastUnmatchedRecord: UnmatchedTopic | undefined
    // Routers are commonly used as a pure delivery primitive. Keep the normal
    // publish path free of emitter state and event-payload allocations until a
    // consumer actually asks to observe it.
    let emitter: EventEmitter<TopicRouterEvents> | undefined

    const ensureEmitter = (): EventEmitter<TopicRouterEvents> => {
        if (emitter === undefined) {
            emitter = buildEventEmitter<TopicRouterEvents>()
        }
        return emitter
    }

    const on: EventEmitter<TopicRouterEvents>['on'] = (
        eventName,
        callback,
    ) => ensureEmitter().on(eventName, callback)

    const emit: EventEmitter<TopicRouterEvents>['emit'] = (eventName, data) => {
        emitter?.emit(eventName, data)
    }

    const unbind = <T = unknown>(
        pattern: string,
        target?: TopicTarget<T>,
    ): void => {
        let removed = 0
        for (let i = routes.length - 1; i >= 0; i -= 1) {
            const route = routes[i]!
            if (route.pattern !== pattern) continue
            if (target !== undefined && route.target !== target) continue
            routes.splice(i, 1)
            removed += 1
        }
        if (removed > 0) {
            routeVersion += 1
            emitter?.emit('router:unbound', { pattern, removed })
        }
    }

    const bind = <T = unknown>(
        pattern: string,
        target: TopicTarget<T>,
    ): (() => void) => {
        if (!isValidPattern(pattern)) {
            const error = new InvalidTopicPatternError(pattern)
            emitter?.emit('router:error', { operation: 'bind', error, pattern })
            throw error
        }

        const hasWildcard =
            pattern.includes(SINGLE_WILDCARD) ||
            pattern.includes(MULTI_WILDCARD)
        routes.push({
            pattern,
            hasWildcard,
            // Exact bindings only compare the original topic string; keep one
            // shared empty array rather than a split array per binding.
            patternParts: hasWildcard
                ? pattern.split(TOPIC_SEPARATOR)
                : EMPTY_PARTS,
            target: target as TopicTarget,
        })
        routeVersion += 1
        emitter?.emit('router:bound', { pattern })
        return () => unbind(pattern, target)
    }

    const publish = <T = unknown>(topic: string, data: T): number => {
        if (!isValidTopic(topic)) {
            const error = new InvalidTopicError(topic)
            emitter?.emit('router:error', {
                operation: 'publish',
                error,
                topic,
            })
            throw error
        }

        const message: TopicMessage<T> = { topic, data }
        let matched = 0
        const startVersion = routeVersion
        // Created only if a wildcard binding is encountered. Exact-only
        // routers stay string-to-string from validation through delivery.
        let topicParts: string[] | undefined

        // Avoid a snapshot allocation in normal operation, but finish safely
        // if a target changes bindings re-entrantly while handling a publish.
        let index = 0
        for (; index < routes.length; index += 1) {
            if (routeVersion !== startVersion) {
                break
            }
            const route = routes[index]!
            if (
                route.hasWildcard
                    ? !matches(
                          route.patternParts,
                          (topicParts ??= topic.split(TOPIC_SEPARATOR)),
                      )
                    : route.pattern !== topic
            ) {
                continue
            }
            matched += 1
            try {
                route.target.enqueue(message as TopicMessage)
            } catch (error) {
                emitter?.emit('router:error', {
                    operation: 'publish',
                    error,
                    topic,
                    pattern: route.pattern,
                })
            }
        }

        // A re-entrant binding change is unusual; pay the snapshot cost only
        // then. The ordinary route stays one loop with no per-publish closure.
        if (index < routes.length) {
            const remaining = routes.slice(index)
            for (let i = 0; i < remaining.length; i += 1) {
                const route = remaining[i]!
                if (
                    route.hasWildcard
                        ? !matches(
                              route.patternParts,
                              (topicParts ??= topic.split(TOPIC_SEPARATOR)),
                          )
                        : route.pattern !== topic
                ) {
                    continue
                }
                matched += 1
                try {
                    route.target.enqueue(message as TopicMessage)
                } catch (error) {
                    emitter?.emit('router:error', {
                        operation: 'publish',
                        error,
                        topic,
                        pattern: route.pattern,
                    })
                }
            }
        }

        if (matched > 0) {
            emitter?.emit('router:published', { topic, data, matched })
            return matched
        }

        unmatchedTotal += 1
        if (trackUnmatched) {
            lastUnmatchedRecord = { topic, data }
        }
        let delivered = false
        if (unmatchedTarget !== undefined) {
            try {
                unmatchedTarget.enqueue({ topic, data })
                delivered = true
            } catch (error) {
                emitter?.emit('router:error', {
                    operation: 'unmatched',
                    error,
                    topic,
                })
            }
        }
        emitter?.emit('router:unmatched', { topic, data, delivered })
        return 0
    }

    const clear = (): void => {
        const removed = routes.length
        if (removed === 0) return
        routes.length = 0
        routeVersion += 1
        emitter?.emit('router:cleared', { removed })
    }

    return {
        bind,
        unbind,
        publish,
        bindings: () => routes.map(({ pattern, target }) => ({ pattern, target })),
        clear,
        setUnmatchedTarget: (target) => {
            unmatchedTarget = target
        },
        getUnmatchedTarget: () => unmatchedTarget,
        unmatchedCount: () => unmatchedTotal,
        lastUnmatched: () => lastUnmatchedRecord,
        clearUnmatched: () => {
            unmatchedTotal = 0
            lastUnmatchedRecord = undefined
        },
        on,
        emit,
    }
}
