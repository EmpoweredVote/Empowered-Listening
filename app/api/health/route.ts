import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'empowered-listening',
    status: 'ok',
    time: new Date().toISOString(),
  });
}
