'use client';

import { useEffect, useState } from 'react';

import { GuestNamePopup } from './GuestNamePopup';
import { useAuth } from '@/lib/auth-context';

/**
 * Globally-mounted gate that shows the GuestNamePopup ONCE — right
 * after the user actively clicks "Play as Guest" and the guest session
 * is created.
 *
 * The trigger is the auth context's `pendingGuestNamePrompt` flag,
 * which `loginAsGuest()` flips on. Returning guests whose token is
 * restored from localStorage on app boot never go through that code
 * path, so they are not re-prompted on every reload.
 *
 * The gate latches the prompt locally so a parent re-render that
 * eagerly clears `pendingGuestNamePrompt` can't dismiss the popup
 * while the user is still typing. Closing the popup acknowledges the
 * flag and unmounts.
 */
export function GuestNameGate() {
  const { user, pendingGuestNamePrompt, acknowledgeGuestPrompt } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (pendingGuestNamePrompt && user?.isGuest) {
      setShow(true);
    }
  }, [pendingGuestNamePrompt, user]);

  if (!show || !user) return null;

  return (
    <GuestNamePopup
      onClose={() => {
        acknowledgeGuestPrompt();
        setShow(false);
      }}
    />
  );
}
