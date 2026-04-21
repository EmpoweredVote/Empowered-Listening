import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import { env } from '@/lib/env';

export type ParticipantRole = 'speaker' | 'moderator';

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
    canPublish: input.role === 'speaker',
    canPublishData: true,
    roomAdmin: input.role === 'moderator',
  };

  at.addGrant(grant);

  // toJwt() is async in livekit-server-sdk v2 — awaiting is REQUIRED.
  // Omitting await returns a pending Promise, which LiveKit rejects as malformed.
  return at.toJwt();
}
