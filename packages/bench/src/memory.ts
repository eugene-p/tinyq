/** Retained-memory table rows and byte formatting. */

export type MemRow = {
  name: string
  /** Retained bytes for holding N jobs. */
  heapDelta: number
  /** Bytes per item (heapDelta / N). */
  heapPerItem: number
}

const KIB = 1 << 10
const MIB = 1 << 20
const GIB = 1 << 30

/** `~` = approximate. Bytes are whole; KiB/MiB/GiB use two decimals. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes)) return '—'
  const sign = bytes < 0 ? '-' : ''
  const abs = Math.abs(bytes)
  if (abs < KIB) return `~${sign}${Math.round(abs)} B`
  if (abs < MIB) return `~${sign}${(abs / KIB).toFixed(2)} KiB`
  if (abs < GIB) return `~${sign}${(abs / MIB).toFixed(2)} MiB`
  return `~${sign}${(abs / GIB).toFixed(2)} GiB`
}

export const isGcExposed = (): boolean =>
  typeof (globalThis as { gc?: () => void }).gc === 'function'
