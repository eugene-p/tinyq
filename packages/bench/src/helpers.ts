import type { Bench } from 'tinybench'
import {
  bold,
  cyan,
  dim,
  green,
  padEndVisible,
  padStartVisible,
  styleLibraryName,
  visibleWidth,
  yellow,
} from './style.js'

/** 1) fifo raw — numbers enq+deq */
export const FIFO_N = 200_000

/** 2) workers raw — empty jobs, number items */
export const WORKER_RAW_JOB_COUNTS = [1_000, 10_000] as const
export const WORKER_RAW_CONCURRENCIES = [1, 4] as const

/** 3–4) workers with 1 KiB payloads (discard vs work) */
export const WORKER_PAYLOAD_BYTES = 1024
export const WORKER_PAYLOAD_JOB_COUNTS = [5_000, 20_000] as const
export const WORKER_PAYLOAD_CONCURRENCIES = [1, 4] as const

export const printHeader = (title: string): void => {
  console.log('')
  console.log('')
  console.log(bold(cyan(`=== ${title} ===`)))
  console.log('')
}

export const formatRate = (n: number): string => {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}

export const formatLatencyMs = (ms: number): string => {
  if (!Number.isFinite(ms)) return '—'
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)} s`
  if (ms >= 1) return `${ms.toFixed(2)} ms`
  if (ms >= 0.001) return `${(ms * 1_000).toFixed(1)} µs`
  return `${Math.round(ms * 1_000_000)} ns`
}

type ColumnAlign = 'left' | 'right'

export const printPlainTable = (
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  options: {
    align?: readonly ColumnAlign[]
    styleCell?: (col: number, plain: string, rowIndex: number) => string
  } = {},
): void => {
  const align =
    options.align ??
    columns.map((_, col): ColumnAlign => (col === 0 ? 'left' : 'right'))

  const widths = columns.map((header, col) =>
    Math.max(
      visibleWidth(header),
      ...rows.map((row) => visibleWidth(row[col] ?? '')),
    ),
  )

  const padCell = (cell: string, col: number): string =>
    align[col] === 'left'
      ? padEndVisible(cell, widths[col]!)
      : padStartVisible(cell, widths[col]!)

  const formatRow = (
    cells: readonly string[],
    rowIndex: number | 'header',
  ): string =>
    cells
      .map((cell, col) => {
        const padded = padCell(cell, col)
        if (rowIndex === 'header') return bold(padded)
        return options.styleCell?.(col, padded, rowIndex) ?? padded
      })
      .join('  ')

  console.log(formatRow(columns, 'header'))
  console.log(dim(widths.map((w) => '─'.repeat(w)).join('  ')))
  for (let i = 0; i < rows.length; i += 1) {
    console.log(formatRow(rows[i]!, i))
  }
  console.log('')
}

type TimingRow = {
  library: string
  opsMed: number
  latencyMedMs: number
  samples: number
}

const collectTimingRows = (bench: Bench): TimingRow[] =>
  bench.tasks.map((task) => {
    const result = task.result
    if (result === undefined || result.error !== undefined) {
      return {
        library: task.name,
        opsMed: Number.NaN,
        latencyMedMs: Number.NaN,
        samples: task.runs,
      }
    }
    return {
      library: task.name,
      opsMed: result.throughput.p50 ?? result.throughput.mean,
      latencyMedMs: result.latency.p50 ?? result.latency.mean,
      samples: result.latency.samples.length,
    }
  })

const styleLibraryCell = (plain: string): string => {
  const name = plain.trimEnd()
  return styleLibraryName(name) + plain.slice(name.length)
}

export const printTimingTable = (
  bench: Bench,
  options: { jobCount?: number } = {},
): void => {
  const { jobCount } = options
  const rows = collectTimingRows(bench)

  if (jobCount !== undefined) {
    printPlainTable(
      ['library', 'jobs/s', 'latency', 'samples'],
      rows.map((row) => [
        row.library,
        formatRate(row.opsMed * jobCount),
        formatLatencyMs(row.latencyMedMs / jobCount),
        row.samples.toLocaleString('en-US'),
      ]),
      {
        styleCell: (col, plain) => {
          if (col === 0) return styleLibraryCell(plain)
          if (col === 1) return green(plain)
          if (col === 2) return yellow(plain)
          if (col === 3) return dim(plain)
          return plain
        },
      },
    )
    return
  }

  printPlainTable(
    ['library', 'ops/s', 'latency', 'samples'],
    rows.map((row) => [
      row.library,
      formatRate(row.opsMed),
      formatLatencyMs(row.latencyMedMs),
      row.samples.toLocaleString('en-US'),
    ]),
    {
      styleCell: (col, plain) => {
        if (col === 0) return styleLibraryCell(plain)
        if (col === 1) return green(plain)
        if (col === 2) return yellow(plain)
        if (col === 3) return dim(plain)
        return plain
      },
    },
  )
}

export const makePayloads = (count: number, bytes: number): Uint8Array[] => {
  const payloads = new Array<Uint8Array>(count)
  for (let i = 0; i < count; i += 1) {
    const buf = new Uint8Array(bytes)
    buf[0] = i & 0xff
    buf[bytes - 1] = (i >>> 8) & 0xff
    for (let j = 1; j < bytes - 1; j += 64) {
      buf[j] = (i + j) & 0xff
    }
    payloads[i] = buf
  }
  return payloads
}
