import axios from 'axios';
import { supabase } from './supabase';
import { recordActivity } from './session-activity';

// ─── Request deduplication for GET requests ──────────────────
// Coalesces identical in-flight GET requests so multiple components
// mounting simultaneously share a single network call.
const inflightGets = new Map<string, Promise<unknown>>();

/** Clear all in-flight GET deduplication entries (e.g. on logout). */
export function clearInflightRequests(): void {
  inflightGets.clear();
}

function dedupeKey(url: string, params?: unknown): string {
  const qs = params ? JSON.stringify(params) : '';
  return `${url}::${qs}`;
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  timeout: 30000, // 30 second timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTransientNetworkError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  const hasResponse = isRecord(error.response);

  if (hasResponse) {
    return false;
  }

  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNABORTED' ||
    message.includes('Network Error') ||
    message.includes('timeout')
  );
}

function canRetryRequest(config: unknown): config is Record<string, unknown> {
  if (!isRecord(config)) {
    return false;
  }

  const method = typeof config.method === 'string' ? config.method.toLowerCase() : 'get';
  return method === 'get' || method === 'head';
}

interface SessionRefreshOutcome {
  accessToken: string | null;
  error: unknown;
}

let refreshSessionInFlight: Promise<SessionRefreshOutcome> | null = null;

function getErrorMessage(error: unknown): string {
  if (!isRecord(error)) {
    return '';
  }
  return typeof error.message === 'string' ? error.message : '';
}

function getErrorStatus(error: unknown): number | null {
  if (!isRecord(error) || !isRecord(error.response)) {
    return null;
  }
  const status = error.response.status;
  return typeof status === 'number' ? status : null;
}

function isTransientAuthServiceError(error: unknown): boolean {
  if (!error) {
    return true;
  }

  if (isTransientNetworkError(error)) {
    return true;
  }

  const status = getErrorStatus(error);
  return status !== null && status >= 500;
}

function isDefinitiveAuthRefreshFailure(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const status = getErrorStatus(error);
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('invalid_grant') ||
    message.includes('refresh token') ||
    message.includes('session not found') ||
    message.includes('auth session missing') ||
    message.includes('jwt expired')
  );
}

function shouldForceLogoutForRefreshFailure(error: unknown): boolean {
  if (isTransientAuthServiceError(error)) {
    return false;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }

  return isDefinitiveAuthRefreshFailure(error);
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.location.pathname !== '/auth/login') {
    window.location.href = '/auth/login';
  }
}

async function refreshSessionSingleFlight(): Promise<SessionRefreshOutcome> {
  if (refreshSessionInFlight) {
    return refreshSessionInFlight;
  }

  refreshSessionInFlight = (async () => {
    try {
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !data.session?.access_token) {
        return {
          accessToken: null,
          error: refreshError || new Error('No session returned from refreshSession'),
        };
      }
      return { accessToken: data.session.access_token, error: null };
    } catch (refreshError) {
      return { accessToken: null, error: refreshError };
    } finally {
      refreshSessionInFlight = null;
    }
  })();

  return refreshSessionInFlight;
}

// Attach Supabase auth token to every request when available
apiClient.interceptors.request.use(async (config) => {
  // Skip if Authorization header is already set (e.g. fetchUserProfile)
  // This also avoids a potential deadlock when called from within onAuthStateChange
  if (config.headers.Authorization) {
    return config;
  }
  try {
    // Race getSession against a 3-second timeout to prevent hangs
    // (e.g. when Supabase client is stuck refreshing an expired token)
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (result && 'data' in result) {
      const session = result.data.session;
      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
        recordActivity();
      }
    }
  } catch {
    // No token available — request proceeds without auth
  }
  return config;
});

// ─── Rate-limit soft warning event ───────────────────────────
// When the server indicates we're approaching the hard limit,
// emit a custom event so the UI can show a yellow warning banner.
export const RATE_LIMIT_WARN_EVENT = 'rate-limit-warn';
const RATE_LIMIT_WARN_KEY = 'rateLimitWarnAt';
export const RATE_LIMIT_WARN_TTL_MS = 120_000;
let _rateLimitWarnTimeout: ReturnType<typeof setTimeout> | null = null;

/** Only recent request-limit signals describe the current session's activity. */
export function getPersistedRateLimitWarn(): { active: boolean; since: string | null } {
  try {
    const ts = localStorage.getItem(RATE_LIMIT_WARN_KEY);
    if (ts) {
      const age = Date.now() - Date.parse(ts);
      if (Number.isFinite(age) && age >= 0 && age < RATE_LIMIT_WARN_TTL_MS) {
        return { active: true, since: ts };
      }
      localStorage.removeItem(RATE_LIMIT_WARN_KEY);
    }
  } catch { /* ignore */ }
  return { active: false, since: null };
}

function checkRateLimitWarn(headers: Record<string, unknown> | undefined) {
  if (headers?.['x-ratelimit-warn'] === 'true') {
    try {
      localStorage.setItem(RATE_LIMIT_WARN_KEY, new Date().toISOString());
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(RATE_LIMIT_WARN_EVENT, { detail: { warn: true } }));
    // This is a per-client request budget, not a measurement of server load.
    if (_rateLimitWarnTimeout) clearTimeout(_rateLimitWarnTimeout);
    _rateLimitWarnTimeout = setTimeout(() => {
      getPersistedRateLimitWarn();
      window.dispatchEvent(new CustomEvent(RATE_LIMIT_WARN_EVENT, { detail: { warn: false } }));
    }, RATE_LIMIT_WARN_TTL_MS);
  }
}

// Handle error responses with improved messages
apiClient.interceptors.response.use(
  (response) => {
    checkRateLimitWarn(response.headers);
    return response;
  },
  async (error) => {
    const originalRequest = error.config as Record<string, unknown> | undefined;

    // Handle 429 Too Many Requests — extract and rethrow with server message
    if (error.response?.status === 429) {
      const serverMessage = error.response.data?.error || 'Too many requests. Please wait a moment and try again.';
      const enhancedError = new Error(serverMessage);
      (enhancedError as { response?: unknown }).response = error.response;
      (enhancedError as { isRateLimitError?: boolean }).isRateLimitError = true;
      return Promise.reject(enhancedError);
    }

    // Retry idempotent requests once when the network is transiently unavailable.
    if (originalRequest && canRetryRequest(originalRequest) && isTransientNetworkError(error)) {
      const hasRetried = originalRequest._networkRetried === true;
      if (!hasRetried) {
        originalRequest._networkRetried = true;
        await new Promise((resolve) => setTimeout(resolve, 400));
        return apiClient(originalRequest);
      }
    }

    // Only attempt refresh once per request, and only on 401.
    // Keep refresh single-flight so parallel tab requests share one token refresh.
    if (error.response?.status === 401 && originalRequest && !originalRequest._retried) {
      originalRequest._retried = true;

      try {
        const refreshOutcome = await refreshSessionSingleFlight();
        if (!refreshOutcome.accessToken) {
          if (shouldForceLogoutForRefreshFailure(refreshOutcome.error)) {
            // 'local' scope: only end this tab's stale session, not every active session for the user.
            await supabase.auth.signOut({ scope: 'local' });
            redirectToLogin();
          }
          return Promise.reject(error);
        }

        // Retry the original request with the new token
        const headers = isRecord(originalRequest.headers)
          ? originalRequest.headers
          : {};
        headers.Authorization = `Bearer ${refreshOutcome.accessToken}`;
        originalRequest.headers = headers;
        return apiClient(originalRequest);
      } catch {
        // For unexpected refresh exceptions, avoid force-logout storms.
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Deduplicated GET — identical concurrent calls share one in-flight request.
 * Use this for endpoints that multiple components call simultaneously on mount
 * (e.g. /api/auth/me, /health, /api/auth/captcha-required).
 */
export function dedupedGet<T = unknown>(url: string, config?: Parameters<typeof apiClient.get>[1]): Promise<import('axios').AxiosResponse<T>> {
  const key = dedupeKey(url, config?.params);
  const existing = inflightGets.get(key);
  if (existing) return existing as Promise<import('axios').AxiosResponse<T>>;

  const request = apiClient.get<T>(url, config).finally(() => {
    inflightGets.delete(key);
  });
  inflightGets.set(key, request);
  return request;
}
