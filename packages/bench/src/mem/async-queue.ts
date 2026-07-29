/** Memory probe: async.queue. CLI: --jobs N --payload BYTES [--concurrency C] */
import { queue as asyncQueue } from 'async'
import { parseMemArgs, runMemScript, type FillHandle } from './common.js'

const args = parseMemArgs()

const openEmpty = (): FillHandle => {
  const q = asyncQueue((_task: { i: number }, cb) => {
    queueMicrotask(() => cb())
  }, args.concurrency)
  q.pause()
  return {
    add: (i) => {
      q.push({ i })
    },
    root: q,
  }
}

const openPayload = (): FillHandle => {
  const items: Uint8Array[] = []
  const q = asyncQueue((_task: Uint8Array, cb) => {
    queueMicrotask(() => cb())
  }, args.concurrency)
  q.pause()
  return {
    add: (i) => {
      const buf = new Uint8Array(args.payloadBytes)
      buf[0] = i & 0xff
      items.push(buf)
      q.push(buf)
    },
    root: { q, items },
  }
}

runMemScript({
  library: 'async.queue',
  args,
  open: args.payloadBytes === 0 ? openEmpty : openPayload,
})
