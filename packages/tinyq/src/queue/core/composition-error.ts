/** Thrown when queue decorators are stacked in an unsupported order. */
export class InvalidQueueCompositionError extends Error {
    override readonly name = 'InvalidQueueCompositionError'

    constructor(message: string) {
        super(message)
    }
}
