/** Memory probe: fastq. CLI: --jobs N --payload BYTES [--concurrency C] */
import fastq from 'fastq'
import { labeledPeer } from '../peer-versions.js'
import { parseMemArgs, runMemScript, type FillHandle } from './common.js'

const args = parseMemArgs()

const openEmpty = (): FillHandle => {
  const q = fastq.promise(async () => {}, args.concurrency)
  q.pause()
  return {
    add: (i) => {
      void q.push({ i })
    },
    root: q,
  }
}

const openPayload = (): FillHandle => {
  const items: Uint8Array[] = []
  const q = fastq.promise(async (_item: Uint8Array) => {}, args.concurrency)
  q.pause()
  return {
    add: (i) => {
      const buf = new Uint8Array(args.payloadBytes)
      buf[0] = i & 0xff
      items.push(buf)
      void q.push(buf)
    },
    root: { q, items },
  }
}

runMemScript({
  library: labeledPeer('fastq', 'fastq'),
  args,
  open: args.payloadBytes === 0 ? openEmpty : openPayload,
})
