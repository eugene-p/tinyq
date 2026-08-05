import { buildTopicRouter } from '@qkitt/tinyq'
import {
  type BenchMode,
  printHeader,
  printTimingTable,
  runTimingTasks,
} from './helpers.js'

const PUBLISHES = 100_000
/** Extra scales for exact-binding lookup cost (wave 0.4). */
const EXACT_BINDING_COUNTS = [1, 100, 1000] as const

const target = { enqueue: (_message: unknown): void => {} }

const bindExactMany = (count: number): ReturnType<typeof buildTopicRouter> => {
  const router = buildTopicRouter()
  for (let i = 0; i < count; i += 1) {
    router.bind(`orders.topic${i}`, target)
  }
  return router
}

/** 5) topic router — publish into no-op queue-shaped targets. */
export const runRouterBench = async (mode: BenchMode): Promise<void> => {
  printHeader(`5) topic router — publishes × ${PUBLISHES.toLocaleString()}`)

  const rows = await runTimingTasks(
    [
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
    ],
    mode,
  )
  printTimingTable(rows, { jobCount: PUBLISHES })

  // 0.4 — exact bindings at realistic scale (last binding is the hit).
  for (const bindings of EXACT_BINDING_COUNTS) {
    printHeader(
      `0.4) topic router — ${bindings} exact bindings, publish last × ${PUBLISHES.toLocaleString()}`,
    )
    const topic = `orders.topic${bindings - 1}`
    const scaleRows = await runTimingTasks(
      [
        {
          name: `@qkitt/tinyq exact ×${bindings}`,
          run: () => {
            const router = bindExactMany(bindings)
            for (let i = 0; i < PUBLISHES; i += 1) {
              router.publish(topic, i)
            }
          },
        },
      ],
      mode,
    )
    printTimingTable(scaleRows, { jobCount: PUBLISHES })
  }
}
