import { isNonNegativeFinite } from './number.util'

export type ExponentialBackoffOptions = {
    /** Base delay in ms for attempt 1. Must be finite ≥ 0. */
    base: number
    /** Cap on delay in ms. Must be finite ≥ 0. Default: Infinity (no cap). */
    max?: number
    /**
     * Jitter fraction in [0, 1]. Multiplies delay by a random factor in
     * `[1 - jitter, 1 + jitter]`. Default: 0 (no jitter).
     */
    jitter?: number
}

/** Thrown when {@link ExponentialBackoffOptions} are invalid. */
export class InvalidBackoffOptionError extends Error {
    override readonly name = 'InvalidBackoffOptionError'

    constructor(message: string) {
        super(message)
    }
}

/**
 * Build a {@link DelayPolicy} with exponential growth: `base * 2^(attempt-1)`,
 * capped at `max`, with optional symmetric jitter.
 */
export const exponentialBackoff = (
    options: ExponentialBackoffOptions,
): ((attempt: number) => number) => {
    const { base, max = Number.POSITIVE_INFINITY, jitter = 0 } = options

    if (!isNonNegativeFinite(base)) {
        throw new InvalidBackoffOptionError(
            'base must be a finite number >= 0',
        )
    }
    if (max !== Number.POSITIVE_INFINITY && !isNonNegativeFinite(max)) {
        throw new InvalidBackoffOptionError(
            'max must be a finite number >= 0 or Infinity',
        )
    }
    if (!isNonNegativeFinite(jitter) || jitter > 1) {
        throw new InvalidBackoffOptionError(
            'jitter must be a finite number in [0, 1]',
        )
    }

    return (attempt: number): number => {
        const exp = Math.max(0, attempt - 1)
        let ms = base * 2 ** exp
        if (ms > max) ms = max
        if (jitter > 0 && ms > 0) {
            const factor = 1 - jitter + Math.random() * jitter * 2
            ms = ms * factor
            if (ms > max) ms = max
            if (ms < 0) ms = 0
        }
        return ms
    }
}
