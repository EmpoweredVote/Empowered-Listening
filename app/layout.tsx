import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { SessionProvider } from '@/components/auth/SessionProvider';
import { assertBypassSafe } from '@/lib/auth/bypass';
import './globals.css';

assertBypassSafe();

const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });

export const metadata: Metadata = {
  title: 'Empowered Listening',
  description: 'Structured civic debate infrastructure for Empowered Vote.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="font-manrope bg-white text-slate-900 antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
