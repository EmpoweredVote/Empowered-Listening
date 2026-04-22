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
