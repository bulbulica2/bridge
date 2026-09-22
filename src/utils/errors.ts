import { isAxiosError } from 'axios';

/**
 * The one axios-error reader for the whole app. Three envelopes reach us:
 * the game endpoints send {status, message, data} (409s included), Laravel
 * validation answers 422 {message, errors: {field: [msg]}}, and auth/policy
 * failures answer a bare {message}. A field error wins over the top-level
 * message because it names the thing the user has to fix.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (isAxiosError(e)) {
    if (!e.response) {
      return 'Cannot reach the server. Please try again later.';
    }
    const data = e.response.data as { message?: string; errors?: Record<string, string[]> };
    const firstError = data.errors && Object.values(data.errors)[0]?.[0];
    if (firstError || data.message) {
      return firstError || data.message!;
    }
  }
  return fallback;
}

/**
 * The HTTP status, or null when the request never reached the server (or the
 * error didn't come from axios at all). Pages branch on this to tell apart an
 * expired session (401), lost rights (403), something that is gone (404) and a
 * view that has simply gone stale (409).
 */
export function statusOf(e: unknown): number | null {
  return isAxiosError(e) ? (e.response?.status ?? null) : null;
}

/**
 * A 422's `errors` bag flattened to the first message per field, so a form
 * can show each one under its own input. Empty for anything that isn't a
 * validation error.
 */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!isAxiosError(e) || e.response?.status !== 422) {
    return {};
  }
  const errors = (e.response.data as { errors?: Record<string, string[]> }).errors ?? {};
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (messages?.[0]) {
      result[field] = messages[0];
    }
  }
  return result;
}
