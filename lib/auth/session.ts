export async function tryRenewSession(): Promise<string | null> {
  try {
    const res = await fetch('https://api.empowered.vote/api/auth/session', {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const { access_token } = await res.json();
    return access_token ?? null;
  } catch {
    return null;
  }
}
