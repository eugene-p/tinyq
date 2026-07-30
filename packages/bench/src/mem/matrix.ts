/** Representative retained-memory matrix. */
import { WORKER_PAYLOAD_BYTES, WORKER_RAW_MEM_JOBS, printHeader, printPlainTable } from '../helpers.js'
import { formatBytes } from '../memory.js'
import { magenta, styleLibraryName } from '../style.js'
import { measureAllIsolated } from './spawn.js'

const cases = [
  {
    title: `memory — ${WORKER_RAW_MEM_JOBS.toLocaleString()} queued object jobs, c=1`,
    jobs: WORKER_RAW_MEM_JOBS,
    payloadBytes: 0,
    concurrency: 1,
  },
  {
    title: `memory — ${WORKER_RAW_MEM_JOBS.toLocaleString()} queued object jobs, c=4`,
    jobs: WORKER_RAW_MEM_JOBS,
    payloadBytes: 0,
    concurrency: 4,
  },
  {
    title: `memory — 20,000 queued ${WORKER_PAYLOAD_BYTES} B payloads, c=1`,
    jobs: 20_000,
    payloadBytes: WORKER_PAYLOAD_BYTES,
    concurrency: 1,
  },
] as const

const main = async (): Promise<void> => {
  for (const options of cases) {
    printHeader(options.title)
    const rows = await measureAllIsolated(options)
    printPlainTable(
      ['library', 'heap Δ', 'heap/item'],
      rows.map((row) => [
        row.name,
        formatBytes(row.heapDelta),
        formatBytes(row.heapPerItem),
      ]),
      {
        styleCell: (col, plain) => {
          if (col === 0) {
            const name = plain.trimEnd()
            return styleLibraryName(name) + plain.slice(name.length)
          }
          return magenta(plain)
        },
      },
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
