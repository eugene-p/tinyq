/** Memory probe: @qkitt/tinyq withWorker. CLI: --jobs N --payload BYTES [--concurrency C] */
import { buildQueue, withWorker } from '@qkitt/tinyq'
import { parseMemArgs, runMemScript, type FillHandle } from './common.js'

const args = parseMemArgs()

const openEmpty = (): FillHandle => {
  // Minimal object jobs (not SMI numbers) so B/item is real slot+value cost.
  const q = withWorker(
    buildQueue<{ i: number }>(),
    async () => {},
    { concurrency: args.concurrency, autoStart: false },
  )
  return {
    add: (i) => {
      q.enqueue({ i })
    },
    root: q,
  }
}

const openPayload = (): FillHandle => {
  const items: Uint8Array[] = []
  const q = withWorker(
    buildQueue<Uint8Array>(),
    async () => {},
    { concurrency: args.concurrency, autoStart: false },
  )
  return {
    add: (i) => {
      const buf = new Uint8Array(args.payloadBytes)
      buf[0] = i & 0xff
      items.push(buf)
      q.enqueue(buf)
    },
    root: { q, items },
  }
}

runMemScript({
  library: '@qkitt/tinyq withWorker',
  args,
  open: args.payloadBytes === 0 ? openEmpty : openPayload,
})
