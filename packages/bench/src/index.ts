import { runFifoBench } from './fifo.js'
import { runWorkerRawBench } from './worker-raw.js'
import { runWorkerPayloadBench } from './worker-payload.js'
import { runWorkerWorkBench } from './worker-work.js'
import type { BenchMode } from './helpers.js'
import { bold, cyan, dim } from './style.js'

const suite = (process.argv[2] ?? 'all').toLowerCase()
const mode: BenchMode = suite === 'full' ? 'full' : 'quick'
const runsAll = suite === 'all' || suite === 'full'

const main = async (): Promise<void> => {
  console.log(bold(cyan('@qkitt/tinyq-bench')))
  console.log(dim(`Node ${process.version} · suite=${suite} · mode=${mode}`))
  console.log(
    dim(
      '1 workers raw · 2 workers payload discard · 3 workers payload work · 4 fifo raw',
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

  if (
    suite !== 'all' &&
    suite !== 'full' &&
    suite !== 'fifo' &&
    suite !== 'worker' &&
    suite !== 'worker-payload' &&
    suite !== 'payload' &&
    suite !== 'worker-work' &&
    suite !== 'work' &&
    suite !== '1' &&
    suite !== '2' &&
    suite !== '3' &&
    suite !== '4'
  ) {
    console.error(
      `Unknown suite "${suite}". Use: all | full | worker|1 | worker-payload|payload|2 | worker-work|work|3 | fifo|4`,
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
