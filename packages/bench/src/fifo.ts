import { buildQueue } from '@qkitt/tinyq'
import Denque from 'denque'
import Queue from 'yocto-queue'
import {
  type BenchMode,
  FIFO_N,
  printHeader,
  printTimingTable,
  runTimingTasks,
} from './helpers.js'
import { labeledPeer } from './peer-versions.js'

/** 4) fifo raw — enq/deq numbers, no worker */
export const runFifoBench = async (mode: BenchMode): Promise<void> => {
  printHeader(`4) fifo raw — numbers × ${FIFO_N.toLocaleString()}`)

  const rows = await runTimingTasks([
    {
      name: '@qkitt/tinyq buildQueue',
      run: () => {
      const q = buildQueue<number>()
      for (let i = 0; i < FIFO_N; i++) q.enqueue(i)
      for (let i = 0; i < FIFO_N; i++) q.dequeue()
      },
    },
    {
      name: labeledPeer('denque', 'denque'),
      run: () => {
      const q = new Denque<number>()
      for (let i = 0; i < FIFO_N; i++) q.push(i)
      for (let i = 0; i < FIFO_N; i++) q.shift()
      },
    },
    {
      name: labeledPeer('yocto-queue', 'yocto-queue'),
      run: () => {
      const q = new Queue<number>()
      for (let i = 0; i < FIFO_N; i++) q.enqueue(i)
      for (let i = 0; i < FIFO_N; i++) q.dequeue()
      },
    },
  ], mode)
  printTimingTable(rows)
}
