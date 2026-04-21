import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
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
