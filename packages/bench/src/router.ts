import { buildTopicRouter } from '@qkitt/tinyq'
import {
  type BenchMode,
  printHeader,
  printTimingTable,
  runTimingTasks,
} from './helpers.js'

const PUBLISHES = 100_000

const target = { enqueue: (_message: unknown): void => {} }

/** 5) topic router — publish into no-op queue-shaped targets. */
export const runRouterBench = async (mode: BenchMode): Promise<void> => {
  printHeader(`5) topic router — publishes × ${PUBLISHES.toLocaleString()}`)

  const rows = await runTimingTasks([
    {
      name: '@qkitt/tinyq exact, no events',
      run: () => {
        const router = buildTopicRouter()
        router.bind('orders.created', target)
        for (let i = 0; i < PUBLISHES; i += 1) {
          router.publish('orders.created', i)
        }
      },
    },
    {
      name: '@qkitt/tinyq wildcard fan-out, no events',
      run: () => {
        const router = buildTopicRouter()
        router.bind('orders.*', target)
        router.bind('orders.#', target)
        for (let i = 0; i < PUBLISHES; i += 1) {
          router.publish('orders.created', i)
        }
      },
    },
    {
      name: '@qkitt/tinyq exact, published listener',
      run: () => {
        const router = buildTopicRouter()
        router.bind('orders.created', target)
        router.on('router:published', () => {})
        for (let i = 0; i < PUBLISHES; i += 1) {
          router.publish('orders.created', i)
        }
      },
    },
  ], mode)
  printTimingTable(rows, { jobCount: PUBLISHES })
}
