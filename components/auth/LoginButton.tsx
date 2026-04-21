'use client';

export function LoginButton() {
  const handleClick = () => {
    const returnUrl = window.location.href;
    window.location.href = `https://accounts.empowered.vote/login?redirect=${encodeURIComponent(returnUrl)}`;
  };

  return (
    <button
      onClick={handleClick}
      type="button"
      className="inline-flex items-center justify-center rounded-md bg-ev-muted-blue px-6 py-3 text-white font-medium hover:opacity-90 transition"
    >
      Log in via Empowered
    </button>
  );
}
