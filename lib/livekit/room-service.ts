import { RoomServiceClient, ServerError, TrackSource } from 'livekit-server-sdk';
import { env } from '@/lib/env';

let _roomService: RoomServiceClient | null = null;

export function getRoomService(): RoomServiceClient {
  if (!_roomService) {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new Error('LiveKit credentials are not configured');
    }
    _roomService = new RoomServiceClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }
  return _roomService;
}

/**
 * How many of the named people are in a debate's LiveKit room.
 *
 * **`countableIdentities` is an allowlist, and it is load-bearing.** A room
 * holds more than the people running the debate: the transcription worker
 * joins as `transcription-worker:<debateId>` on segment start and stays until
 * teardown, and room-composite egress puts a recorder in there too. Counting
 * every participant would mean a live debate's room is never empty — so the
 * abandon watcher would never end anything, and self-lockingly, since the
 * worker only leaves when `teardownDebateMedia` runs and that is the very
 * thing the watcher is trying to reach.
 *
 * An allowlist rather than a denylist of service prefixes: it stays correct
 * when something new joins a room, and it means we do not have to settle
 * whether LiveKit reports recorders as hidden. Pass the debate's
 * `debate_speakers.livekit_identity` values.
 *
 * Three answers, and the difference between the last two is the whole point:
 *
 *   * **A number** — that many of the named people are connected.
 *   * **`0`** — none of them are, *including* when LiveKit has never heard of
 *     the room. A room is created on first join, so "no such room" and "nobody
 *     in the room" are the same fact, and a debate nobody ever joined must
 *     still be able to start its abandon clock.
 *   * **`null`** — LiveKit could not be asked at all. Not an empty room: an
 *     unanswerable question. `nextEmptySince` holds its clock on this rather
 *     than treating it as evidence, so an outage cannot cancel every live
 *     debate at once.
 *
 * Matched on the error's `code`/`status` rather than its message text, so a
 * reworded upstream message cannot silently turn a missing room into an
 * outage.
 */
export async function countParticipants(
  roomName: string,
  countableIdentities: ReadonlySet<string>,
): Promise<number | null> {
  try {
    const participants = await getRoomService().listParticipants(roomName);
    return participants.filter(p => countableIdentities.has(p.identity)).length;
  } catch (err) {
    if (err instanceof ServerError && (err.code === 'not_found' || err.status === 404)) {
      // Routine: deliberately not logged, or every poll of a room between
      // debates would write a line.
      return 0;
    }
    console.warn(`[livekit] could not count participants in ${roomName}:`, err);
    return null;
  }
}

export async function setMicPermission(
  roomName: string,
  identity: string,
  canPublish: boolean,
): Promise<void> {
  await getRoomService().updateParticipant(roomName, identity, {
    permission: {
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Restrict to audio-only when muting; allow camera+mic when active.
      canPublishSources: canPublish
        ? [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE]
        : [TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
    },
  });
}
