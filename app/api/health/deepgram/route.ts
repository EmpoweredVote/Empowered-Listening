import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` },
    });
    const body = await res.json();
    return NextResponse.json({ status: res.status, ok: res.ok, body });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
