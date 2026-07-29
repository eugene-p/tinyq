/**
 * Minimal ANSI styling for bench output.
 * Disabled when stdout is not a TTY or `NO_COLOR` is set.
 */

const force = process.env.FORCE_COLOR
const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''

/** On for TTY; off for `NO_COLOR`; `FORCE_COLOR=0` off, any other FORCE_COLOR on. */
const enabled = (() => {
  if (force === '0') return false
  if (force !== undefined && force !== '') return true
  if (noColor) return false
  return process.stdout.isTTY === true
})()

const wrap =
  (open: string, close: string) =>
  (text: string): string =>
    enabled ? `${open}${text}${close}` : text

export const bold = wrap('\x1b[1m', '\x1b[22m')
export const dim = wrap('\x1b[2m', '\x1b[22m')
export const cyan = wrap('\x1b[36m', '\x1b[39m')
export const green = wrap('\x1b[32m', '\x1b[39m')
export const yellow = wrap('\x1b[33m', '\x1b[39m')
export const magenta = wrap('\x1b[35m', '\x1b[39m')

/** Visible width ignoring CSI sequences (for table padding). */
export const visibleWidth = (text: string): number =>
  text.replace(/\x1b\[[0-9;]*m/g, '').length

export const padEndVisible = (text: string, width: number): string => {
  const pad = width - visibleWidth(text)
  return pad > 0 ? text + ' '.repeat(pad) : text
}

export const padStartVisible = (text: string, width: number): string => {
  const pad = width - visibleWidth(text)
  return pad > 0 ? ' '.repeat(pad) + text : text
}

/** Highlight first-party rows in tables. */
export const styleLibraryName = (name: string): string =>
  name.includes('@qkitt/') || name.includes('tinyq')
    ? bold(cyan(name))
    : name
