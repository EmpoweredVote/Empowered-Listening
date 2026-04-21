'use client';

import { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

/**
 * When the server grants canPublish: true via updateParticipant, LiveKit does not
 * automatically start publishing — the client must call setMicrophoneEnabled(true).
 * This hook listens for ParticipantPermissionsChanged on the local participant and
 * toggles the mic track accordingly.
 *
 * Must be mounted INSIDE <LiveKitRoom> so useLocalParticipant() has context.
 */
export function useMicAutoPublish(): void {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;

    const handler = () => {
      const canPublish = !!localParticipant.permissions?.canPublish;
      if (canPublish && !localParticipant.isMicrophoneEnabled) {
        void localParticipant.setMicrophoneEnabled(true);
      }
      // Revocation is handled automatically by LiveKit — it unpublishes and prevents republish.
      // We do not need to call setMicrophoneEnabled(false) explicitly.
    };

    localParticipant.on('participantPermissionsChanged', handler);
    // Also run once in case permissions are already set at mount.
    handler();
    return () => { localParticipant.off('participantPermissionsChanged', handler); };
  }, [localParticipant]);
}
