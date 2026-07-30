import { Bench } from 'tinybench'
import {
  bold,
  cyan,
  dim,
  green,
  magenta,
  padEndVisible,
  padStartVisible,
  styleLibraryName,
  visibleWidth,
  yellow,
} from './style.js'

/** 4) fifo raw — numbers enq+deq */
export const FIFO_N = 200_000

/** 1) workers raw — async no-op jobs, number items */
export const WORKER_RAW_JOB_COUNTS = [5_000, 20_000] as const
export const WORKER_RAW_CONCURRENCIES = [1, 4] as const
/** Empty-job memory sample size (marginal B/item). */
export const WORKER_RAW_MEM_JOBS = 20_000

/** 2–3) workers with 1 KiB payloads (discard vs work) */
export const WORKER_PAYLOAD_BYTES = 1024
export const WORKER_PAYLOAD_JOB_COUNTS = [5_000, 20_000] as const
export const WORKER_PAYLOAD_CONCURRENCIES = [1, 4] as const

export type BenchMode = 'quick' | 'full'

export const isFullBenchMode = (mode: BenchMode): boolean => mode === 'full'

type TimingTask = {
  name: string
  run: () => void | Promise<void>
}

type TimingRow = {
  library: string
  opsMed: number
  latencyMedMs: number
  opsMin: number
  opsMax: number
  samples: number
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * Runs rotated passes and aggregates their p50s.
 */
export const runTimingTasks = async (
  tasks: readonly TimingTask[],
  mode: BenchMode,
): Promise<TimingRow[]> => {
  const repetitions = mode === 'quick' ? 3 : 1
  // Quick mode uses fixed samples; full mode is time-based.
  const time = mode === 'quick' ? 0 : 800
  const warmupTime = mode === 'quick' ? 0 : 150
  const iterations = mode === 'quick' ? 20 : 10
  const warmupIterations = mode === 'quick' ? 12 : 5
  const byName = new Map<string, Array<{ ops: number; latency: number; samples: number }>>(
    tasks.map((task) => [task.name, []]),
  )

  for (let pass = 0; pass < repetitions; pass += 1) {
    const bench = new Bench({ time, warmupTime, iterations, warmupIterations })
    for (let offset = 0; offset < tasks.length; offset += 1) {
      const task = tasks[(offset + pass) % tasks.length]!
      bench.add(task.name, task.run)
    }
    await bench.run()

    for (const task of bench.tasks) {
      const result = task.result
      if (result === undefined || result.error !== undefined) {
        throw result?.error ?? new Error(`${task.name}: no benchmark result`)
      }
      byName.get(task.name)!.push({
        ops: result.throughput.p50 ?? result.throughput.mean,
        latency: result.latency.p50 ?? result.latency.mean,
        samples: result.latency.samples.length,
      })
    }
  }

  return tasks.map((task) => {
    const results = byName.get(task.name)!
    const ops = results.map((result) => result.ops)
    const latencies = results.map((result) => result.latency)
    return {
      library: task.name,
      opsMed: median(ops),
      latencyMedMs: median(latencies),
      opsMin: Math.min(...ops),
      opsMax: Math.max(...ops),
      samples: results.reduce((sum, result) => sum + result.samples, 0),
    }
  })
}

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

const styleLibraryCell = (plain: string): string => {
  const name = plain.trimEnd()
  return styleLibraryName(name) + plain.slice(name.length)
}

export const printTimingTable = (
  rows: readonly TimingRow[],
  options: { jobCount?: number } = {},
): void => {
  const { jobCount } = options

  if (jobCount !== undefined) {
    const columns = ['library', 'jobs/s', 'latency', 'pass range', 'samples'] as const

    printPlainTable(
      columns,
      rows.map((row) => {
        const base = [
          row.library,
          formatRate(row.opsMed * jobCount),
          formatLatencyMs(row.latencyMedMs / jobCount),
          `${formatRate(row.opsMin * jobCount)}–${formatRate(row.opsMax * jobCount)}`,
        ]
        base.push(row.samples.toLocaleString('en-US'))
        return base
      }),
      {
        styleCell: (col, plain) => {
          if (col === 0) return styleLibraryCell(plain)
          if (col === 1) return green(plain)
          if (col === 2) return yellow(plain)
          if (col === 3) return cyan(plain)
          if (col === 4) return dim(plain)
          return plain
        },
      },
    )
    return
  }

  printPlainTable(
    ['library', 'ops/s', 'latency', 'pass range', 'samples'],
    rows.map((row) => [
      row.library,
      formatRate(row.opsMed),
      formatLatencyMs(row.latencyMedMs),
      `${formatRate(row.opsMin)}–${formatRate(row.opsMax)}`,
      row.samples.toLocaleString('en-US'),
    ]),
    {
      styleCell: (col, plain) => {
        if (col === 0) return styleLibraryCell(plain)
        if (col === 1) return green(plain)
        if (col === 2) return yellow(plain)
        if (col === 3) return cyan(plain)
        if (col === 4) return dim(plain)
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
