import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@livekit/rtc-node', '@livekit/rtc-ffi-bindings'],
};

export default nextConfig;
