/** CLI + measure helpers for per-library memory scripts under `src/mem/`. */

export type MemArgs = {
  jobs: number
  payloadBytes: number
  concurrency: number
}

export type MemResult = {
  library: string
  jobs: number
  payloadBytes: number
  concurrency: number
  heapDelta: number
  heapPerItem: number
}

/** Open a paused queue; `add(i)` enqueues the i-th job; keep `root` alive. */
export type FillHandle = {
  add: (i: number) => void
  root: unknown
}

/** V8 heap objects + TypedArray/Buffer backing stores. */
export const retainedBytes = (): number => {
  const m = process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}

export const tryGc = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc
  if (gc) gc()
}

const parseIntArg = (raw: string | undefined, name: string): number => {
  if (raw === undefined || raw === '') {
    throw new Error(`Missing --${name}`)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --${name}=${raw} (need non-negative integer)`)
  }
  return n
}

/** `--jobs N --payload BYTES [--concurrency C]`. `payload` 0 = empty number jobs. */
export const parseMemArgs = (
  argv: readonly string[] = process.argv.slice(2),
): MemArgs => {
  let jobs: number | undefined
  let payloadBytes: number | undefined
  let concurrency = 1

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    const next = (): string => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`Missing value after ${a}`)
      }
      i += 1
      return v
    }
    if (a === '--jobs' || a === '-n') jobs = parseIntArg(next(), 'jobs')
    else if (a.startsWith('--jobs='))
      jobs = parseIntArg(a.slice('--jobs='.length), 'jobs')
    else if (a === '--payload' || a === '-p')
      payloadBytes = parseIntArg(next(), 'payload')
    else if (a.startsWith('--payload='))
      payloadBytes = parseIntArg(a.slice('--payload='.length), 'payload')
    else if (a === '--concurrency' || a === '-c')
      concurrency = parseIntArg(next(), 'concurrency')
    else if (a.startsWith('--concurrency='))
      concurrency = parseIntArg(a.slice('--concurrency='.length), 'concurrency')
    else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: --jobs N --payload BYTES [--concurrency C]\n' +
          '  payload 0 = empty object jobs; otherwise N×payload Uint8Array jobs',
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown arg: ${a}`)
    }
  }

  if (jobs === undefined) throw new Error('Required: --jobs N')
  if (payloadBytes === undefined) throw new Error('Required: --payload BYTES')
  if (concurrency < 1) throw new Error('--concurrency must be ≥ 1')

  return { jobs, payloadBytes, concurrency }
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Drop non-positive / absurd samples (GC mid-fill). */
const medianPositive = (values: readonly number[]): number => {
  const ok = values.filter((v) => Number.isFinite(v) && v >= 0)
  if (ok.length === 0) return median(values)
  return median(ok)
}

const SAMPLES = 7

/**
 * Fill N jobs, median retained Δ over samples. per-item = total / N.
 * Empty jobs should use a large N (suite 2 samples at WORKER_RAW_MEM_JOBS).
 * Minimal object jobs (not SMI numbers) so each item has real heap cost.
 */
export const measureRetained = (
  open: () => FillHandle,
  args: MemArgs,
): { heapDelta: number; heapPerItem: number } => {
  const { jobs } = args
  if (jobs <= 0) return { heapDelta: 0, heapPerItem: 0 }

  const totals: number[] = []
  for (let s = 0; s < SAMPLES; s += 1) {
    tryGc()
    const before = retainedBytes()
    const h = open()
    for (let i = 0; i < jobs; i += 1) h.add(i)
    const after = retainedBytes()
    void h.root
    totals.push(after - before)
  }

  const heapDelta = medianPositive(totals)
  return { heapDelta, heapPerItem: heapDelta / jobs }
}

export const runMemScript = (options: {
  library: string
  args: MemArgs
  open: () => FillHandle
}): void => {
  const { library, args, open } = options
  const { heapDelta, heapPerItem } = measureRetained(open, args)
  const result: MemResult = {
    library,
    jobs: args.jobs,
    payloadBytes: args.payloadBytes,
    concurrency: args.concurrency,
    heapDelta,
    heapPerItem,
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
