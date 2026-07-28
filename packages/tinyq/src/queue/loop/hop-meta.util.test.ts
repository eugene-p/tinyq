import { describe, expect, it } from 'vitest'
import {
    buildLoopQueueMeta,
    getLoopHops,
    TQ_KEY,
    queueMetaEqual,
    stampLoopHops,
} from './hop-meta.util'

describe('getLoopHops', () => {
    it('reads __tq.loop[name].hops', () => {
        expect(
            getLoopHops(
                {
                    [TQ_KEY]: { loop: { jobs: { hops: 3 } } },
                },
                'jobs',
            ),
        ).toBe(3)
    })

    it('returns undefined when missing or invalid', () => {
        expect(getLoopHops({}, 'jobs')).toBeUndefined()
        expect(getLoopHops(null, 'jobs')).toBeUndefined()
        expect(
            getLoopHops(
                { [TQ_KEY]: { loop: { jobs: { hops: 'x' } } } },
                'jobs',
            ),
        ).toBeUndefined()
        expect(
            getLoopHops(
                { meta: { jobs: { hops: 1 } } },
                'jobs',
            ),
        ).toBeUndefined()
    })
})

describe('stampLoopHops', () => {
    it('stamps plain objects and preserves user fields', () => {
        const original = { id: 'a' }
        const stamped = stampLoopHops(
            { id: 'a', reason: 'x' },
            original,
            'jobs',
            1,
        )
        expect(stamped).toEqual({
            id: 'a',
            reason: 'x',
            [TQ_KEY]: { loop: { jobs: { hops: 1 } } },
        })
    })

    it('wraps non-plain values', () => {
        expect(stampLoopHops(9, 9, 'n', 1)).toEqual({
            value: 9,
            [TQ_KEY]: { loop: { n: { hops: 1 } } },
        })
    })

    it('preserves sibling loop names from original', () => {
        const original = {
            id: 'a',
            [TQ_KEY]: {
                loop: { other: { hops: 5 }, jobs: { hops: 1 } },
            },
        }
        const stamped = stampLoopHops(original, original, 'jobs', 2) as {
            [TQ_KEY]: { loop: Record<string, { hops: number }> }
        }
        expect(stamped[TQ_KEY].loop).toEqual({
            other: { hops: 5 },
            jobs: { hops: 2 },
        })
    })

    it('overwrites user __tq on mapped result', () => {
        const original = { id: 'a' }
        const mapped = {
            id: 'a',
            [TQ_KEY]: { loop: { jobs: { hops: 99 } } },
        }
        const stamped = stampLoopHops(mapped, original, 'jobs', 1)
        expect(getLoopHops(stamped, 'jobs')).toBe(1)
    })
})

describe('queueMetaEqual', () => {
    it('compares structure', () => {
        expect(queueMetaEqual(undefined, undefined)).toBe(true)
        expect(
            queueMetaEqual(
                { loop: { jobs: { hops: 1 } } },
                { loop: { jobs: { hops: 1 } } },
            ),
        ).toBe(true)
        expect(
            queueMetaEqual(
                { loop: { jobs: { hops: 1 } } },
                { loop: { jobs: { hops: 2 } } },
            ),
        ).toBe(false)
    })
})

describe('buildLoopQueueMeta', () => {
    it('increments from empty original', () => {
        expect(buildLoopQueueMeta({}, 'jobs', 1)).toEqual({
            loop: { jobs: { hops: 1 } },
        })
    })
})
