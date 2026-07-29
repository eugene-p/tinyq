/** Run each library memory script in its own Node process. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MemRow } from '../memory.js'
import type { MemResult } from './common.js'

const MEM_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(MEM_DIR, '../..')
const require = createRequire(import.meta.url)
const TSX_CLI = require.resolve('tsx/cli')

export const MEM_LIBRARIES = [
  { id: 'tinyq', script: 'tinyq.ts', library: '@qkitt/tinyq withWorker' },
  { id: 'fastq', script: 'fastq.ts', library: 'fastq' },
  { id: 'p-queue', script: 'p-queue.ts', library: 'p-queue' },
  { id: 'async-queue', script: 'async-queue.ts', library: 'async.queue' },
] as const

export type MemSpawnOptions = {
  jobs: number
  payloadBytes: number
  concurrency: number
}

const spawnOne = (
  scriptFile: string,
  options: MemSpawnOptions,
): Promise<MemResult> =>
  new Promise((resolve, reject) => {
    const scriptPath = path.join(MEM_DIR, scriptFile)
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        TSX_CLI,
        scriptPath,
        '--jobs',
        String(options.jobs),
        '--payload',
        String(options.payloadBytes),
        '--concurrency',
        String(options.concurrency),
      ],
      {
        cwd: PACKAGE_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `mem ${scriptFile} exited ${code}\n${stderr || stdout || '(no output)'}`,
          ),
        )
        return
      }
      const line = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith('{'))
      if (line === undefined) {
        reject(
          new Error(
            `mem ${scriptFile}: no JSON on stdout\nstdout=${stdout}\nstderr=${stderr}`,
          ),
        )
        return
      }
      try {
        resolve(JSON.parse(line) as MemResult)
      } catch (error) {
        reject(
          new Error(
            `mem ${scriptFile}: bad JSON: ${line}\n${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      }
    })
  })

export const measureAllIsolated = async (
  options: MemSpawnOptions,
): Promise<readonly MemRow[]> => {
  const rows: MemRow[] = []
  for (const lib of MEM_LIBRARIES) {
    const result = await spawnOne(lib.script, options)
    rows.push({
      name: result.library,
      heapDelta: result.heapDelta,
      heapPerItem: result.heapPerItem,
    })
  }
  return rows
}
