import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export const PEER_PACKAGES = [
  { label: 'async.queue', packageName: 'async' },
  { label: 'fastq', packageName: 'fastq' },
  { label: 'p-queue', packageName: 'p-queue' },
  { label: 'denque', packageName: 'denque' },
  { label: 'yocto-queue', packageName: 'yocto-queue' },
] as const

export const readInstalledVersion = (packageName: string): string => {
  const entry = require.resolve(packageName)
  let dir = dirname(entry)
  while (true) {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string
        version?: string
      }
      if (manifest.name === packageName && typeof manifest.version === 'string') {
        return manifest.version
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`could not read version for ${packageName}`)
    }
    dir = parent
  }
}

export const labeledPeer = (label: string, packageName: string): string =>
  `${label} ${readInstalledVersion(packageName)}`

export const formatPeerVersionsLine = (): string =>
  PEER_PACKAGES.map(
    ({ label, packageName }) => `${label} ${readInstalledVersion(packageName)}`,
  ).join(' · ')
