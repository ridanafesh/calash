'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { UserProfile } from '@calash/shared';

import { apiClient } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  /**
   * True for one render cycle right after `loginAsGuest()` resolves —
   * the GuestNameGate watches this so the popup only appears immediately
   * after the user actively clicks "Play as Guest", NOT on every page
   * load that happens to restore a guest token from localStorage.
   * Cleared by `acknowledgeGuestPrompt()` once the popup is shown.
   */
  pendingGuestNamePrompt: boolean;
  acknowledgeGuestPrompt: () => void;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingGuestNamePrompt, setPendingGuestNamePrompt] = useState(false);

  const acknowledgeGuestPrompt = useCallback(() => {
    setPendingGuestNamePrompt(false);
  }, []);

  function persist(newToken: string, newUser: UserProfile) {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(newUser);
  }

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiClient.me();
      setUser(data.user);
    } catch {
      // Token expired or invalid — clear session
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
    }
  }, []);

  // On mount, restore session from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('token');
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setToken(stored);
    apiClient
      .me()
      .then((data) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem('token');
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function loginWithPassword(email: string, password: string) {
    const data = await apiClient.login({ email, password });
    persist(data.token, data.user);
  }

  async function loginWithGoogle(credential: string) {
    const data = await apiClient.loginWithGoogle({ credential });
    persist(data.token, data.user);
  }

  async function loginAsGuest() {
    const data = await apiClient.loginAsGuest();
    persist(data.token, data.user);
    // Only fresh guest signups should trigger the name popup. Returning
    // guests whose token was restored from localStorage on app boot
    // never go through this code path, so they are not prompted.
    setPendingGuestNamePrompt(true);
  }

  function logout() {
    apiClient.logout().catch(() => {});
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setPendingGuestNamePrompt(false);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        pendingGuestNamePrompt,
        acknowledgeGuestPrompt,
        loginWithPassword,
        loginWithGoogle,
        loginAsGuest,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
