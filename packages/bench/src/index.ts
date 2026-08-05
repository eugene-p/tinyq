import { runFifoBench } from './fifo.js'
import { runFifoSteadyBench } from './fifo-steady.js'
import { runRetrySyncBench } from './retry-sync.js'
import { runRouterBench } from './router.js'
import { runWorkerLoopBench } from './worker-loop.js'
import { runWorkerRawBench } from './worker-raw.js'
import { runWorkerPayloadBench } from './worker-payload.js'
import { runWorkerWorkBench } from './worker-work.js'
import type { BenchMode } from './helpers.js'
import { bold, cyan, dim } from './style.js'

const suite = (process.argv[2] ?? 'all').toLowerCase()
const mode: BenchMode = suite === 'full' ? 'full' : 'quick'
const runsAll = suite === 'all' || suite === 'full'

const knownSuites = new Set([
  'all',
  'full',
  'worker',
  '1',
  'worker-payload',
  'payload',
  '2',
  'worker-work',
  'work',
  '3',
  'fifo',
  '4',
  'router',
  '5',
  'worker-loop',
  'fifo-steady',
  'retry-sync',
])

const main = async (): Promise<void> => {
  console.log(bold(cyan('@qkitt/tinyq-bench')))
  console.log(dim(`Node ${process.version} · suite=${suite} · mode=${mode}`))
  console.log(
    dim(
      '1 workers raw · 2 payload discard · 3 payload work · 4 fifo · 5 router · worker-loop · fifo-steady · retry-sync',
    ),
  )

  if (runsAll || suite === 'worker' || suite === '1') {
    await runWorkerRawBench(mode)
  }
  if (
    runsAll ||
    suite === 'worker-payload' ||
    suite === 'payload' ||
    suite === '2'
  ) {
    await runWorkerPayloadBench(mode)
  }
  if (
    runsAll ||
    suite === 'worker-work' ||
    suite === 'work' ||
    suite === '3'
  ) {
    await runWorkerWorkBench(mode)
  }
  if (runsAll || suite === 'fifo' || suite === '4') {
    await runFifoBench(mode)
  }
  if (runsAll || suite === 'router' || suite === '5') {
    await runRouterBench(mode)
  }
  if (runsAll || suite === 'worker-loop') {
    await runWorkerLoopBench(mode)
  }
  if (runsAll || suite === 'fifo-steady') {
    await runFifoSteadyBench(mode)
  }
  if (runsAll || suite === 'retry-sync') {
    await runRetrySyncBench(mode)
  }

  if (!knownSuites.has(suite)) {
    console.error(
      `Unknown suite "${suite}". Use: all | full | worker|1 | worker-payload|payload|2 | worker-work|work|3 | fifo|4 | router|5 | worker-loop | fifo-steady | retry-sync`,
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
