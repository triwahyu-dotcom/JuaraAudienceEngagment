import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterServiceWorker } from '@/lib/sw-register';

export const metadata: Metadata = {
  title: 'JUARA Passport',
  description: 'Passport digital event: kumpulkan poin di tiap station, tukar dengan merchandise.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1F31AB' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        {/* Font brand JUARA (Adobe Fonts). Bila kit tidak mengizinkan domain ini, font cadangan di bawah yang dipakai. */}
        <link rel="stylesheet" href="https://use.typekit.net/uqi5guw.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Space+Mono:ital,wght@0,700;1,700&display=swap" />
      </head>
      <body>{children}<RegisterServiceWorker /></body>
    </html>
  );
}
