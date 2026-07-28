import {
  whenIdle,
  type IdleWaitable,
  type WhenIdleOptions,
} from '@qkitt/tinyq'

export const title = (name: string, fields?: string): void => {
  console.log(name)
  if (fields) console.log(fields)
}

export const phase = (name: string): void => {
  console.log()
  console.log(`--- ${name} ---`)
}

export const line = (kind: string, action: string, fields?: string): void => {
  const base = `${kind.padEnd(7)} ${action.padEnd(7)}`
  console.log(fields ? `${base} ${fields}` : base)
}

export const summary = (fields: string): void => {
  phase('summary')
  console.log(fields)
  console.log()
  console.log('==========')
  console.log()
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Default budget so example scripts cannot hang forever. */
export const EXAMPLE_WAIT_TIMEOUT_MS = 10_000

/**
 * Drain wait with a default timeout. Override via `options.timeoutMs`.
 * Prefer this over bare `whenIdle` in examples.
 */
export const waitIdle = (
  queue: IdleWaitable,
  options: WhenIdleOptions = {},
): Promise<void> =>
  whenIdle(queue, {
    timeoutMs: EXAMPLE_WAIT_TIMEOUT_MS,
    ...options,
  })

/**
 * Race any promise against a wall-clock budget (e.g. completion counters
 * that cannot use `whenIdle` because of delayed loop re-entry).
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  ms = EXAMPLE_WAIT_TIMEOUT_MS,
  label = 'wait',
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export { sleep }
