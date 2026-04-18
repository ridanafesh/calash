export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ─── User profile (safe to send to clients) ──────────────────────────────────

export interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null; // null for guests
  isGuest: boolean;
}

// ─── Auth requests / responses ────────────────────────────────────────────────

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GoogleAuthRequest {
  credential: string; // Google ID token from @react-oauth/google
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export interface UpdateProfileRequest {
  displayName?: string;
  avatarUrl?: string;
}

// ─── Guest upgrade stubs ──────────────────────────────────────────────────────

export interface UpgradeWithPasswordRequest {
  email: string;
  password: string;
  username?: string;
}

export interface UpgradeWithGoogleRequest {
  credential: string;
}
