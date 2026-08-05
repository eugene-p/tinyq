/**
 * Minimal AbortSignal surface (DOM / Node) without requiring the DOM lib.
 * Real `AbortSignal` instances satisfy this structurally.
 */
export type AbortSignalLike = {
    readonly aborted: boolean
    readonly reason?: unknown
    addEventListener: (
        type: 'abort',
        listener: () => void,
        options?: { once?: boolean },
    ) => void
    removeEventListener: (type: 'abort', listener: () => void) => void
}
