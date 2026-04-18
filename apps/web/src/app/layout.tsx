import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Calash — Multiplayer Card Game',
  description: 'Play Calash with friends in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
