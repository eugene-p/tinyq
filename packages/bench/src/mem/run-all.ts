/** Run all four library memory probes. */
import { formatBytes, isGcExposed } from '../memory.js'
import { printPlainTable } from '../helpers.js'
import { dim, magenta, styleLibraryName } from '../style.js'
import { parseMemArgs } from './common.js'
import { measureAllIsolated } from './spawn.js'

const args = parseMemArgs()

const main = async (): Promise<void> => {
  console.error(
    dim(
      `mem · jobs=${args.jobs} payload=${args.payloadBytes} B c=${args.concurrency}`,
    ),
  )

  const rows = await measureAllIsolated(args)

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
        if (col === 1 || col === 2) return magenta(plain)
        return plain
      },
    },
  )

  if (!isGcExposed()) {
    console.error(dim('  tip: run with --expose-gc (npm run mem already does)'))
  }

  process.stdout.write(
    `${JSON.stringify(
      rows.map((row) => ({
        library: row.name,
        jobs: args.jobs,
        payloadBytes: args.payloadBytes,
        concurrency: args.concurrency,
        heapDelta: row.heapDelta,
        heapPerItem: row.heapPerItem,
      })),
    )}\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
