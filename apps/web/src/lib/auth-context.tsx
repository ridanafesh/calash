'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { UserProfile } from '@calash/shared';

import { apiClient } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
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
  }

  function logout() {
    apiClient.logout().catch(() => {});
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, loginWithPassword, loginWithGoogle, loginAsGuest, logout, refreshUser }}
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
