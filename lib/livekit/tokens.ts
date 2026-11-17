import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import { env } from '@/lib/env';

export type ParticipantRole = 'speaker' | 'moderator' | 'worker';

export interface MintTokenInput {
  identity: string;
  roomName: string;
  role: ParticipantRole;
  ttlSeconds?: number;
}

export async function mintToken(input: MintTokenInput): Promise<string> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new Error('LiveKit credentials are not configured');
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: input.identity,
    ttl: input.ttlSeconds ?? 60 * 60 * 4,
  });

  const grant: VideoGrant = {
    room: input.roomName,
    roomJoin: true,
    canSubscribe: true,
    // Moderators publish too. They run the debate out loud — introducing
    // segments, calling time, asking the next speaker to begin — and with
    // canPublish false they could not be heard in their own room at all,
    // which meant moderating over a separate call while the debate ran.
    //
    // Their mic is NOT on the segment schedule: applySegmentMicPermissions
    // touches only the two speakers, and useMicAutoPublish returns early for a
    // moderator. So nothing contends with the manual control on their tile.
    //
    // Workers never publish — they only listen, for transcription.
    canPublish: input.role !== 'worker',
    canPublishData: input.role !== 'worker',    // workers don't send data messages
    roomAdmin: input.role === 'moderator',       // workers have no admin rights
  };

  at.addGrant(grant);

  // toJwt() is async in livekit-server-sdk v2 — awaiting is REQUIRED.
  // Omitting await returns a pending Promise, which LiveKit rejects as malformed.
  return at.toJwt();
}
