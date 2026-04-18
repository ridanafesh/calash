'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from './auth-context';

interface AuthGuardProps {
  children: React.ReactNode;
  /** If true, redirect guests (isGuest=true) as well as unauthenticated users. */
  requireFullAccount?: boolean;
  /** Where to redirect unauthenticated users. Defaults to /auth/login. */
  redirectTo?: string;
}

/**
 * Wraps a page or section that requires authentication.
 * Renders nothing while the session is loading, then either shows children
 * or redirects to the login page.
 */
export function AuthGuard({
  children,
  requireFullAccount = false,
  redirectTo = '/auth/login',
}: AuthGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(redirectTo);
      return;
    }
    if (requireFullAccount && user.isGuest) {
      router.replace('/settings?upgrade=true');
    }
  }, [isLoading, user, requireFullAccount, redirectTo, router]);

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      </div>
    );
  }

  if (!user) return null;
  if (requireFullAccount && user.isGuest) return null;

  return <>{children}</>;
}
