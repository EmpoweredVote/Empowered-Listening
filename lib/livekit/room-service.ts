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
 * How many people are in a debate's LiveKit room.
 *
 * Three answers, and the difference between the last two is the whole point:
 *
 *   * **A number** — that many participants are connected.
 *   * **`0`** — the room is empty, *including* when LiveKit has never heard of
 *     it. A room is created on first join, so "no such room" and "nobody in
 *     the room" are the same fact, and a debate nobody ever joined must still
 *     be able to start its abandon clock.
 *   * **`null`** — LiveKit could not be asked at all. Not an empty room: an
 *     unanswerable question. `nextEmptySince` holds its clock on this rather
 *     than treating it as evidence, so an outage cannot cancel every live
 *     debate at once.
 *
 * Matched on the error's `code`/`status` rather than its message text, so a
 * reworded upstream message cannot silently turn a missing room into an
 * outage.
 */
export async function countParticipants(roomName: string): Promise<number | null> {
  try {
    const participants = await getRoomService().listParticipants(roomName);
    return participants.length;
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
