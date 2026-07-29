import { buildQueue } from '@qkitt/tinyq'
import { Bench } from 'tinybench'
import Denque from 'denque'
import Queue from 'yocto-queue'
import { FIFO_N, printHeader, printTimingTable } from './helpers.js'

/** 1) fifo raw — enq/deq numbers, no worker */
export const runFifoBench = async (): Promise<void> => {
  printHeader(`1) fifo raw — numbers × ${FIFO_N.toLocaleString()}`)

  const bench = new Bench({ time: 500, warmupTime: 100 })

  bench
    .add('@qkitt/tinyq buildQueue', () => {
      const q = buildQueue<number>()
      for (let i = 0; i < FIFO_N; i++) q.enqueue(i)
      for (let i = 0; i < FIFO_N; i++) q.dequeue()
    })
    .add('denque', () => {
      const q = new Denque<number>()
      for (let i = 0; i < FIFO_N; i++) q.push(i)
      for (let i = 0; i < FIFO_N; i++) q.shift()
    })
    .add('yocto-queue', () => {
      const q = new Queue<number>()
      for (let i = 0; i < FIFO_N; i++) q.enqueue(i)
      for (let i = 0; i < FIFO_N; i++) q.dequeue()
    })

  await bench.run()
  printTimingTable(bench)
}
