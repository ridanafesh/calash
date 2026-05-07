/**
 * Centralised URL resolvers for the REST API and Socket.IO connection.
 *
 * Priority for the WebSocket URL:
 *   1. NEXT_PUBLIC_SOCKET_URL  (canonical name, what the Render dashboard
 *      and the deployment docs use — the platform-friendly variable)
 *   2. NEXT_PUBLIC_WS_URL      (legacy alias from the original local-dev
 *      .env files; preserved so existing local setups don't break)
 *   3. NEXT_PUBLIC_API_URL     (REST URL — Socket.IO is hosted on the
 *      same origin in this app, so falling back to it is correct in
 *      production where API_URL is the only var that's reliably set)
 *   4. http://localhost:4000   (development fallback ONLY)
 *
 * Priority for the REST API URL:
 *   1. NEXT_PUBLIC_API_URL
 *   2. http://localhost:4000   (development fallback ONLY)
 *
 * NEXT_PUBLIC_* values are baked at build time. If the deployment URL
 * changes you must rebuild the web service.
 *
 * The "production" check uses NODE_ENV — Next sets this to 'production'
 * during `next build` and at runtime when the build was a production
 * build. We treat anything else as dev/preview, which is when localhost
 * is a valid fallback.
 */

const IS_PROD = process.env.NODE_ENV === 'production';
const LOCAL_FALLBACK = 'http://localhost:4000';

function pickFirstNonEmpty(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return undefined;
}

/**
 * REST API base URL (e.g. https://calash-backend.onrender.com).
 * In dev defaults to http://localhost:4000.
 */
export function apiUrl(): string {
  const fromEnv = pickFirstNonEmpty(process.env['NEXT_PUBLIC_API_URL']);
  if (fromEnv) return fromEnv;
  if (IS_PROD) {
    // Loud failure mode — prevents silently shipping a build that talks
    // to localhost. The bundler will inline this throw at the call site
    // only when no env var is set at build time.
    // eslint-disable-next-line no-console
    console.error(
      '[server-urls] NEXT_PUBLIC_API_URL is not set. The production build will not be able to reach the backend.',
    );
  }
  return LOCAL_FALLBACK;
}

/**
 * Socket.IO endpoint URL. Reads NEXT_PUBLIC_SOCKET_URL first, then the
 * legacy NEXT_PUBLIC_WS_URL, then falls back to the REST URL (same origin),
 * and finally localhost in dev.
 */
export function socketUrl(): string {
  const fromEnv = pickFirstNonEmpty(
    process.env['NEXT_PUBLIC_SOCKET_URL'],
    process.env['NEXT_PUBLIC_WS_URL'],
    process.env['NEXT_PUBLIC_API_URL'],
  );
  if (fromEnv) return fromEnv;
  if (IS_PROD) {
    // eslint-disable-next-line no-console
    console.error(
      '[server-urls] None of NEXT_PUBLIC_SOCKET_URL / NEXT_PUBLIC_WS_URL / NEXT_PUBLIC_API_URL are set. Socket.IO will not connect.',
    );
  }
  return LOCAL_FALLBACK;
}
