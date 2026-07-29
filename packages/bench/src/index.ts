import { runFifoBench } from './fifo.js'
import { runWorkerRawBench } from './worker-raw.js'
import { runWorkerPayloadBench } from './worker-payload.js'
import { runWorkerWorkBench } from './worker-work.js'
import { bold, cyan, dim } from './style.js'

const suite = (process.argv[2] ?? 'all').toLowerCase()

const main = async (): Promise<void> => {
  console.log(bold(cyan('@qkitt/tinyq-bench')))
  console.log(dim(`Node ${process.version} · suite=${suite}`))
  console.log(
    dim(
      '1 fifo raw · 2 workers raw · 3 workers payload discard · 4 workers payload work',
    ),
  )

  if (suite === 'all' || suite === 'fifo' || suite === '1') {
    await runFifoBench()
  }
  if (suite === 'all' || suite === 'worker' || suite === '2') {
    await runWorkerRawBench()
  }
  if (
    suite === 'all' ||
    suite === 'worker-payload' ||
    suite === 'payload' ||
    suite === '3'
  ) {
    await runWorkerPayloadBench()
  }
  if (
    suite === 'all' ||
    suite === 'worker-work' ||
    suite === 'work' ||
    suite === '4'
  ) {
    await runWorkerWorkBench()
  }

  if (
    suite !== 'all' &&
    suite !== 'fifo' &&
    suite !== '1' &&
    suite !== 'worker' &&
    suite !== '2' &&
    suite !== 'worker-payload' &&
    suite !== 'payload' &&
    suite !== '3' &&
    suite !== 'worker-work' &&
    suite !== 'work' &&
    suite !== '4'
  ) {
    console.error(
      `Unknown suite "${suite}". Use: all | fifo|1 | worker|2 | worker-payload|3 | worker-work|4`,
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
