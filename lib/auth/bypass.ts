export function assertBypassSafe(): void {
  if (process.env.AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'development') {
    throw new Error(
      'AUTH_BYPASS=1 is set in a non-development environment. ' +
      'This is a critical security misconfiguration. Refusing to start.'
    );
  }
}

export function isBypassActive(): boolean {
  return process.env.AUTH_BYPASS === '1' && process.env.NODE_ENV === 'development';
}
