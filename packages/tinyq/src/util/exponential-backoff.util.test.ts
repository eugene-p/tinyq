import { describe, expect, it, vi } from 'vitest'
import {
    exponentialBackoff,
    InvalidBackoffOptionError,
} from './exponential-backoff.util'

describe('exponentialBackoff', () => {
    it('grows as base * 2^(attempt-1) and caps at max', () => {
        const delay = exponentialBackoff({ base: 10, max: 50 })
        expect(delay(1)).toBe(10)
        expect(delay(2)).toBe(20)
        expect(delay(3)).toBe(40)
        expect(delay(4)).toBe(50)
        expect(delay(10)).toBe(50)
    })

    it('applies jitter within [1-j, 1+j]', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        const delay = exponentialBackoff({ base: 100, jitter: 0.2 })
        // factor = 1 - 0.2 + 0.5 * 0.4 = 1.0
        expect(delay(1)).toBe(100)
        vi.spyOn(Math, 'random').mockReturnValue(0)
        // factor = 0.8
        expect(delay(1)).toBe(80)
        vi.restoreAllMocks()
    })

    it('rejects invalid options', () => {
        expect(() => exponentialBackoff({ base: -1 })).toThrow(
            InvalidBackoffOptionError,
        )
        expect(() => exponentialBackoff({ base: 1, jitter: 2 })).toThrow(
            InvalidBackoffOptionError,
        )
    })
})
