/** Memory probe: p-queue. CLI: --jobs N --payload BYTES [--concurrency C] */
import PQueue from 'p-queue'
import { labeledPeer } from '../peer-versions.js'
import { parseMemArgs, runMemScript, type FillHandle } from './common.js'

const args = parseMemArgs()

const openEmpty = (): FillHandle => {
  const q = new PQueue({ concurrency: args.concurrency, autoStart: false })
  const jobs: { i: number }[] = []
  return {
    add: (i) => {
      const job = { i }
      jobs.push(job)
      void q.add(async () => {
        void job
      })
    },
    root: { q, jobs },
  }
}

const openPayload = (): FillHandle => {
  const items: Uint8Array[] = []
  const q = new PQueue({ concurrency: args.concurrency, autoStart: false })
  return {
    add: (i) => {
      const buf = new Uint8Array(args.payloadBytes)
      buf[0] = i & 0xff
      items.push(buf)
      void q.add(async () => {
        void buf
      })
    },
    root: { q, items },
  }
}

runMemScript({
  library: labeledPeer('p-queue', 'p-queue'),
  args,
  open: args.payloadBytes === 0 ? openEmpty : openPayload,
})
