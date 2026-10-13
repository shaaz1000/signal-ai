import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/navigation/shell';
import { PrefsProvider } from '@/lib/client/platform';
import { getFeedData, getPrefs } from '@/lib/server/data';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'SIGNAL / AI', template: '%s · SIGNAL / AI' },
  description: 'What people are building, releasing and testing across AI and emerging technology, with the evidence behind each item.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#101114' },
  ],
};

// Every page reads live records and the preferences cookie.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const prefs = await getPrefs();
  // The shell must render even when the database is down, so the error page has navigation.
  const status = await getFeedData().then((d) => d.status).catch(() => null);
  return (
    <html lang="en" data-theme={prefs.theme === 'system' ? undefined : prefs.theme} data-density={prefs.density === 'compact' ? 'compact' : undefined}>
      <body>
        <PrefsProvider initial={prefs}>
          <Shell status={status} now={new Date().toISOString()}>{children}</Shell>
        </PrefsProvider>
      </body>
    </html>
  );
}
