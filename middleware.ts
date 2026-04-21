import { NextRequest, NextResponse, userAgent } from 'next/server';

const JOIN_PATHS = /^\/join\/(speaker|moderator)(\/|$)/;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (JOIN_PATHS.test(pathname)) {
    const { device } = userAgent(request);
    if (device.type === 'mobile' || device.type === 'tablet') {
      const response = NextResponse.next();
      response.headers.set('x-mobile-gate', '1');
      return response;
    }
  }

  if (process.env.AUTH_BYPASS === '1' && process.env.NODE_ENV === 'development') {
    const response = NextResponse.next();
    response.headers.set('x-user-id', '00000000-0000-0000-0000-000000000001');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/join/:path*'],
};
