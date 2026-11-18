import 'server-only';
import {
  EgressClient,
  StreamOutput,
  StreamProtocol,
  EncodingOptionsPreset,
} from 'livekit-server-sdk';
import { env } from '@/lib/env';

let _egressClient: EgressClient | null = null;

function getEgressClient(): EgressClient {
  if (!_egressClient) {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      throw new Error('LiveKit credentials are not configured');
    }
    _egressClient = new EgressClient(
      env.LIVEKIT_URL,
      env.LIVEKIT_API_KEY,
      env.LIVEKIT_API_SECRET,
    );
  }
  return _egressClient;
}

export async function startDebateEgress(
  roomName: string,
  muxStreamKey: string,
): Promise<string> {
  const client = getEgressClient();

  const active = await client.listEgress({ roomName, active: true });
  if (active.length > 0 && active[0].egressId) {
    return active[0].egressId;
  }

  const info = await client.startRoomCompositeEgress(
    roomName,
    new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls: [`mux://${muxStreamKey}`],
    }),
    {
      layout: 'speaker',
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
    },
  );
  if (!info.egressId) {
    throw new Error('startRoomCompositeEgress returned no egressId');
  }
  return info.egressId;
}

export async function stopDebateEgress(egressId: string): Promise<void> {
  await getEgressClient().stopEgress(egressId);
}

export interface ActiveEgress {
  egressId: string;
  roomName: string;
  /** Milliseconds this egress has been running, or 0 when LiveKit reports no start time. */
  ageMs: number;
}

/**
 * Every egress LiveKit currently considers active, across the whole project.
 *
 * Deliberately asks LiveKit rather than reading `livekit_egress_id`: the leak
 * this exists to catch is our column and reality disagreeing, so a sweep built
 * on the column would be blind to exactly the orphans it is meant to find.
 */
export async function listActiveEgress(): Promise<ActiveEgress[]> {
  const infos = await getEgressClient().listEgress({ active: true });
  const now = Date.now();
  return infos
    .filter(info => info.egressId && info.roomName)
    .map(info => ({
      egressId: info.egressId,
      roomName: info.roomName,
      // startedAt is an int64 of NANOseconds since the epoch, and is 0 for an
      // egress that has not started yet. Treat unknown as age 0, which the
      // sweep's grace period then protects.
      // Number() on a nanosecond epoch loses sub-microsecond precision, which
      // is irrelevant against a two-minute grace period.
      ageMs: info.startedAt ? Math.max(0, now - Number(info.startedAt) / 1e6) : 0,
    }));
}
