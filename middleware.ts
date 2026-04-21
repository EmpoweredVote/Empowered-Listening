import { NextRequest, NextResponse, userAgent } from 'next/server';
import { verifyToken } from './lib/auth/jwks';

const JOIN_PATHS = /^\/join\/(speaker|moderator)(\/|$)/;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isJoinPath = JOIN_PATHS.test(pathname);

  if (isJoinPath) {
    const { device } = userAgent(request);
    const isMobileOrTablet = device.type === 'mobile' || device.type === 'tablet';
    if (isMobileOrTablet) {
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

  if (isJoinPath) {
    const token = request.cookies.get('ev_token')?.value
      ?? request.headers.get('authorization')?.slice(7);

    if (!token) {
      const returnUrl = encodeURIComponent(request.url);
      return NextResponse.redirect(
        `https://accounts.empowered.vote/login?redirect=${returnUrl}`
      );
    }

    try {
      const payload = await verifyToken(token);
      const response = NextResponse.next({
        request: { headers: new Headers(request.headers) },
      });
      response.headers.set('x-user-id', payload.sub as string);
      return response;
    } catch {
      const returnUrl = encodeURIComponent(request.url);
      return NextResponse.redirect(
        `https://accounts.empowered.vote/login?redirect=${returnUrl}`
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/join/:path*'],
};
