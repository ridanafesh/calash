'use client';

import { useEffect, useState } from 'react';

import { GuestNamePopup } from './GuestNamePopup';
import { useAuth } from '@/lib/auth-context';

const STORAGE_PREFIX = 'calash:guest-name-set:';

/**
 * Globally-mounted gate that shows the GuestNamePopup once per guest
 * session. We key the "already prompted" flag on the user id so a
 * fresh guest signup gets a fresh prompt, but the same guest reopening
 * the app on the same device skips the popup (their chosen name is
 * already on the server).
 *
 * Logic:
 *   - User must be loaded and isGuest=true
 *   - localStorage must NOT have calash:guest-name-set:<userId>
 *
 * On dismiss/save we set the flag so the popup never re-fires for this
 * user on this device.
 */
export function GuestNameGate() {
  const { user, isLoading } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isLoading || !user || !user.isGuest) {
      setShow(false);
      return;
    }
    try {
      const flagged = window.localStorage.getItem(STORAGE_PREFIX + user.id);
      setShow(!flagged);
    } catch {
      // localStorage unavailable (private mode); show once per page load.
      setShow(true);
    }
  }, [isLoading, user]);

  if (!show || !user) return null;

  return (
    <GuestNamePopup
      onClose={() => {
        try {
          window.localStorage.setItem(STORAGE_PREFIX + user.id, '1');
        } catch {
          // ignore
        }
        setShow(false);
      }}
    />
  );
}
