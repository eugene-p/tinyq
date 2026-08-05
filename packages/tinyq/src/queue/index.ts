export {
    buildQueue,
    InvalidQueueOptionError,
    QueueFullError,
    type BuildQueueOptions,
    type OverflowPolicy,
    type Queue,
    type QueueEvents,
    type QueueSlot,
    type QueueStats,
} from './core/queue'

export { InvalidQueueCompositionError } from './core/composition-error'

export { getQueueName } from './core/queue-name.util'

export {
    InvalidWorkerOptionError,
    withWorker,
    type QueueWithWorker,
    type WithWorkerOptions,
    type WorkerControls,
    type WorkerEvents,
} from './worker/with-worker'

export {
    LifecycleTimeoutError,
    whenIdle,
    type IdleWaitable,
    type WhenIdleOptions,
} from './worker/when-idle'

export {
    drain,
    type Drainable,
    type DrainOptions,
} from './worker/drain'

export {
    gracefulStop,
    type GracefulStopable,
    type GracefulStopOptions,
} from './worker/graceful-stop'

export {
    DeadLetterEnqueueError,
    InvalidDeadLetterOptionError,
    withDeadLetter,
    withDlq,
    type DeadLetterEvents,
    type DeadLetterQueueEvents,
    type DeadLetterTarget,
    type WithDeadLetterOptions,
} from './dlq/with-dead-letter'

export {
    getLoopHops,
    InvalidLoopOptionError,
    LoopEnqueueError,
    TQ_KEY,
    withLoop,
    type LoopControls,
    type LoopEvents,
    type LoopMapContext,
    type LoopQueueEvents,
    type WithLoopOptions,
} from './loop/with-loop'
