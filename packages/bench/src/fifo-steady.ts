import { buildQueue } from '@qkitt/tinyq'
import { type BenchMode, printHeader, printPlainTable } from './helpers.js'
import { formatBytes, isGcExposed } from './memory.js'
import { bold, cyan, dim, green, yellow } from './style.js'

/**
 * 0.2) long-run FIFO at steady size ≥ 1 (never empties).
 * Measures retained heap over many enqueue/dequeue cycles.
 */

const CYCLES = 1_000_000
const STEADY_SIZE = 1

const forceGc = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc
  if (typeof gc === 'function') gc()
}

const heapUsed = (): number => process.memoryUsage().heapUsed

const runSteadyFifo = (cycles: number) => {
  const q = buildQueue<number>()
  // Seed so the queue never empties during the cycle loop.
  for (let i = 0; i < STEADY_SIZE; i += 1) q.enqueue(i)

  for (let i = 0; i < cycles; i += 1) {
    q.enqueue(i + STEADY_SIZE)
    q.dequeue()
  }

  // Keep a live reference so the queue is not collected mid-measure.
  if (q.size() !== STEADY_SIZE) {
    throw new Error(`expected steady size ${STEADY_SIZE}, got ${q.size()}`)
  }

  return q
}

export const runFifoSteadyBench = async (_mode: BenchMode): Promise<void> => {
  printHeader(
    `0.2) fifo steady — ${CYCLES.toLocaleString()} enq/deq at size≥${STEADY_SIZE}`,
  )

  if (!isGcExposed()) {
    console.log(
      yellow(
        'GC not exposed — run with --expose-gc for retained-heap numbers. Timing only.',
      ),
    )
  }

  // Warmup
  runSteadyFifo(10_000)
  forceGc()
  await new Promise((r) => setTimeout(r, 20))

  forceGc()
  const before = heapUsed()
  const t0 = performance.now()
  const measuredQueue = runSteadyFifo(CYCLES)
  const elapsedMs = performance.now() - t0
  forceGc()
  await new Promise((r) => setTimeout(r, 20))
  forceGc()
  const after = heapUsed()
  const delta = after - before

  // Read after GC so the measured queue remains live through the retained
  // heap sample rather than being collected as soon as runSteadyFifo returns.
  if (measuredQueue.size() !== STEADY_SIZE) {
    throw new Error(
      `expected measured queue size ${STEADY_SIZE}, got ${measuredQueue.size()}`,
    )
  }

  const opsPerSec = CYCLES / (elapsedMs / 1000)

  printPlainTable(
    ['metric', 'value'],
    [
      ['cycles', CYCLES.toLocaleString('en-US')],
      ['steady size', String(STEADY_SIZE)],
      ['elapsed', `${elapsedMs.toFixed(1)} ms`],
      ['ops/s', Math.round(opsPerSec).toLocaleString('en-US')],
      ['heap before', formatBytes(before)],
      ['heap after', formatBytes(after)],
      ['heap delta', formatBytes(delta)],
    ],
    {
      align: ['left', 'right'],
      styleCell: (col, plain) => {
        if (col === 0) return dim(plain)
        if (col === 1) return green(plain)
        return plain
      },
    },
  )

  console.log(
    dim(
      'Heap delta should stay bounded after head compaction; without it, backing array grows with cycles.',
    ),
  )
  console.log(bold(cyan('done')))
}
