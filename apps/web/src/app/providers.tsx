'use client';

import { GoogleOAuthProvider } from '@react-oauth/google';

import { AuthProvider } from '@/lib/auth-context';
import { GameProvider } from '@/lib/game-context';

const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] ?? '';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <GameProvider>{children}</GameProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
