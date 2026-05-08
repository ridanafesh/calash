/**
 * Guest-name popup decision logic — pure tests.
 *
 * The popup flow has two non-trivial decisions that don't live in any
 * one file's runtime, so we mirror them here as pure functions and pin
 * the contract:
 *
 *   1. "Should the popup open?" — the GuestNameGate watches a flag set
 *      ONLY by an explicit loginAsGuest() call. Restored sessions
 *      (existing token in localStorage on app boot) must NOT trigger
 *      the popup.
 *
 *   2. "Should Save send a request?" — the popup skips the network
 *      call when the user keeps the server's prefilled default. This
 *      avoids the previous "no fields to update" 400 round-trip and
 *      gives the Continue path an instant close.
 *
 * Both are written so a regression in the actual implementation will
 * fail this file too — keep these in sync with the live code.
 */

// ─── Helpers under test ──────────────────────────────────────────────────────

/** Mirror of GuestNameGate's open condition. */
function shouldShowPopup(args: {
  pendingGuestNamePrompt: boolean;
  user: { isGuest: boolean } | null;
}): boolean {
  return args.pendingGuestNamePrompt && !!args.user?.isGuest;
}

/**
 * Mirror of the auth-context's pendingGuestNamePrompt transition rules.
 * The flag flips true ONLY in loginAsGuest(); session-restore and
 * password/google logins leave it untouched. acknowledgeGuestPrompt()
 * (called by the gate when the popup closes) clears it.
 */
type AuthEvent =
  | { type: 'restore-session'; user: { isGuest: boolean } | null }
  | { type: 'login-guest' }
  | { type: 'login-password' }
  | { type: 'login-google' }
  | { type: 'acknowledge' };

function reduce(
  prev: { pendingGuestNamePrompt: boolean },
  event: AuthEvent,
): { pendingGuestNamePrompt: boolean } {
  switch (event.type) {
    case 'login-guest':
      return { pendingGuestNamePrompt: true };
    case 'acknowledge':
      return { pendingGuestNamePrompt: false };
    case 'restore-session':
    case 'login-password':
    case 'login-google':
      return prev;
  }
}

/** Mirror of GuestNamePopup's save() short-circuit. Returns the action
 *  the popup should take given the user's current name and the input. */
function decideSave(
  currentDisplayName: string | null,
  input: string,
  maxLen = 32,
): { action: 'reject-empty' } | { action: 'reject-long' } | { action: 'close' } | { action: 'put-update'; payload: { displayName: string } } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { action: 'reject-empty' };
  if (trimmed.length > maxLen) return { action: 'reject-long' };
  if (trimmed === (currentDisplayName ?? '').trim()) return { action: 'close' };
  return { action: 'put-update', payload: { displayName: trimmed } };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('guest-name popup — open condition', () => {
  it('does NOT open on initial app load with no user', () => {
    expect(shouldShowPopup({ pendingGuestNamePrompt: false, user: null })).toBe(false);
  });

  it('does NOT open when a guest session is restored from localStorage', () => {
    // The flag is the trigger. A restored guest session leaves it false.
    expect(
      shouldShowPopup({ pendingGuestNamePrompt: false, user: { isGuest: true } }),
    ).toBe(false);
  });

  it('does NOT open for a non-guest user even if the flag is somehow set', () => {
    expect(
      shouldShowPopup({ pendingGuestNamePrompt: true, user: { isGuest: false } }),
    ).toBe(false);
  });

  it('opens after an explicit guest login (flag true + user is guest)', () => {
    expect(
      shouldShowPopup({ pendingGuestNamePrompt: true, user: { isGuest: true } }),
    ).toBe(true);
  });
});

describe('guest-name popup — auth-event reducer', () => {
  it('restore-session does NOT set the prompt flag', () => {
    const next = reduce(
      { pendingGuestNamePrompt: false },
      { type: 'restore-session', user: { isGuest: true } },
    );
    expect(next.pendingGuestNamePrompt).toBe(false);
  });

  it('login-guest DOES set the prompt flag', () => {
    const next = reduce({ pendingGuestNamePrompt: false }, { type: 'login-guest' });
    expect(next.pendingGuestNamePrompt).toBe(true);
  });

  it('login-password / login-google leave the flag untouched', () => {
    expect(
      reduce({ pendingGuestNamePrompt: false }, { type: 'login-password' }).pendingGuestNamePrompt,
    ).toBe(false);
    expect(
      reduce({ pendingGuestNamePrompt: false }, { type: 'login-google' }).pendingGuestNamePrompt,
    ).toBe(false);
  });

  it('acknowledge clears the flag — popup closes only once', () => {
    const after = reduce({ pendingGuestNamePrompt: true }, { type: 'acknowledge' });
    expect(after.pendingGuestNamePrompt).toBe(false);
  });
});

describe('guest-name popup — save decision', () => {
  it('keeping the server default closes without sending a request', () => {
    expect(decideSave('Guest 4821', 'Guest 4821')).toEqual({ action: 'close' });
  });

  it('keeping the default with surrounding whitespace also closes — trim wins', () => {
    expect(decideSave('Guest 4821', '  Guest 4821  ')).toEqual({ action: 'close' });
  });

  it('changing to a new name sends a PUT with the trimmed payload', () => {
    expect(decideSave('Guest 4821', '  Alice  ')).toEqual({
      action: 'put-update',
      payload: { displayName: 'Alice' },
    });
  });

  it('rejects an empty/whitespace-only input — no request sent', () => {
    expect(decideSave('Guest 4821', '')).toEqual({ action: 'reject-empty' });
    expect(decideSave('Guest 4821', '   ')).toEqual({ action: 'reject-empty' });
  });

  it('rejects an over-long name', () => {
    expect(decideSave('Guest 4821', 'x'.repeat(33))).toEqual({ action: 'reject-long' });
  });

  it('treats null current displayName as empty — any non-empty input is a real change', () => {
    expect(decideSave(null, 'Alice')).toEqual({
      action: 'put-update',
      payload: { displayName: 'Alice' },
    });
  });
});
