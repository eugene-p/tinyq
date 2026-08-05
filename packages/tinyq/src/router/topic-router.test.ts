import { describe, expect, it, vi } from 'vitest'
import { buildQueue } from '../queue/core/queue'
import {
    buildTopicRouter,
    InvalidTopicError,
    InvalidTopicPatternError,
    type TopicMessage,
} from './topic-router'

describe('buildTopicRouter', () => {
    it('routes exact and wildcard topics to every matching queue', () => {
        const router = buildTopicRouter()
        const exact = buildQueue<TopicMessage>()
        const one = buildQueue<TopicMessage>()
        const many = buildQueue<TopicMessage>()

        router.bind('orders.created', exact)
        router.bind('orders.*', one)
        router.bind('orders.#', many)

        expect(router.publish('orders.created', { id: 1 })).toBe(3)
        expect(exact.toArray()).toEqual([
            { topic: 'orders.created', data: { id: 1 } },
        ])
        expect(one.size()).toBe(1)
        expect(many.size()).toBe(1)

        router.publish('orders.created.eu', { id: 2 })
        expect(one.size()).toBe(1)
        expect(many.size()).toBe(2)
    })

    it('returns an unbind function for an individual binding', () => {
        const router = buildTopicRouter()
        const queue = buildQueue<TopicMessage>()
        const unbind = router.bind('metrics.#', queue)

        unbind()
        router.publish('metrics.cpu', 0.42)
        expect(queue.isEmpty()).toBe(true)
    })

    it('indexes many exact bindings and preserves duplicate targets', () => {
        const router = buildTopicRouter()
        const queues = Array.from({ length: 100 }, () =>
            buildQueue<TopicMessage>(),
        )
        for (let i = 0; i < queues.length; i += 1) {
            router.bind(`metrics.host${i}`, queues[i]!)
        }
        router.bind('metrics.host99', queues[0]!)

        expect(router.publish('metrics.host99', 42)).toBe(2)
        expect(queues[99]!.size()).toBe(1)
        expect(queues[0]!.size()).toBe(1)

        router.unbind('metrics.host99', queues[0]!)
        expect(router.publish('metrics.host99', 43)).toBe(1)
        expect(queues[99]!.size()).toBe(2)
        expect(queues[0]!.size()).toBe(1)
    })

    it('tracks and optionally delivers unmatched topics', () => {
        const unmatched = buildQueue<TopicMessage>()
        const router = buildTopicRouter({ unmatchedTarget: unmatched })
        const onUnmatched = vi.fn()
        router.on('router:unmatched', onUnmatched)

        expect(router.publish('orphan.event', 1)).toBe(0)
        expect(unmatched.toArray()).toEqual([
            { topic: 'orphan.event', data: 1 },
        ])
        expect(router.unmatchedCount()).toBe(1)
        expect(router.lastUnmatched()).toEqual({
            topic: 'orphan.event',
            data: 1,
        })
        expect(onUnmatched).toHaveBeenCalledWith({
            topic: 'orphan.event',
            data: 1,
            delivered: true,
        })
    })

    it('skips lastUnmatched retention when trackUnmatched is false', () => {
        const router = buildTopicRouter({ trackUnmatched: false })
        expect(router.publish('orphan.event', 1)).toBe(0)
        expect(router.unmatchedCount()).toBe(1)
        expect(router.lastUnmatched()).toBeUndefined()
    })

    it('isolates target failures and reports them', () => {
        const router = buildTopicRouter()
        const onError = vi.fn()
        router.on('router:error', onError)
        router.bind('orders.#', {
            enqueue: () => {
                throw new Error('full')
            },
        })

        expect(router.publish('orders.created', 1)).toBe(1)
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'publish' }),
        )
    })

    it('rejects invalid patterns and concrete topics', () => {
        const router = buildTopicRouter()
        expect(() => router.bind('orders.#.created', buildQueue())).toThrow(
            InvalidTopicPatternError,
        )
        expect(() => router.publish('orders.*', 1)).toThrow(InvalidTopicError)
        expect(() => router.publish('orders..created', 1)).toThrow(
            InvalidTopicError,
        )
        expect(() => router.publish('orders.', 1)).toThrow(InvalidTopicError)
    })
})
