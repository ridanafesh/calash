'use client';

import { GoogleOAuthProvider } from '@react-oauth/google';

import { AuthProvider } from '@/lib/auth-context';
import { GameProvider } from '@/lib/game-context';
import { I18nProvider } from '@/lib/i18n';

const GOOGLE_CLIENT_ID = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] ?? '';

export function Providers({ children }: { children: React.ReactNode }) {
  // I18nProvider wraps everything else so any auth/game subtree can
  // call useT() / useI18n() — including login + lobby + waiting room +
  // the full GameBoard tree.
  return (
    <I18nProvider>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <AuthProvider>
          <GameProvider>{children}</GameProvider>
        </AuthProvider>
      </GoogleOAuthProvider>
    </I18nProvider>
  );
}
