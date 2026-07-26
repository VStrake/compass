import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Compass Studio',
  description:
    'Compass Studio — design, analyze, and present commercial office buildings in the browser.',
  applicationName: 'Compass Studio',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0f1115',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-full bg-[#0f1115] text-[#e5e7eb] antialiased">{children}</body>
    </html>
  );
}
