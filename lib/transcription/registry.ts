import type { TranscriptionWorker } from './worker';

/**
 * Singleton Map of active transcription workers keyed by debateId.
 * Shared between the transcription API route and the segments route
 * so both can start and stop the same worker instance.
 */
const activeWorkers = new Map<string, TranscriptionWorker>();

export { activeWorkers };
