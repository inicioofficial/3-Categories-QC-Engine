const SURVEYCTO_SESSION_KEY = "three_categories_surveycto_session";
const SURVEYCTO_SESSION_EXPIRES_KEY = "three_categories_surveycto_session_expires_at";

function clearStoredSurveyCtoSession() {
  sessionStorage.removeItem(SURVEYCTO_SESSION_KEY);
  sessionStorage.removeItem(SURVEYCTO_SESSION_EXPIRES_KEY);
}

/**
 * SurveyCTO media authentication is managed by the backend with Render env vars.
 * Legacy per-user session tokens are deliberately disabled.
 */
export function getSurveyCtoSessionToken() {
  clearStoredSurveyCtoSession();
  return null;
}

export function clearSurveyCtoSessionToken() {
  clearStoredSurveyCtoSession();
}

/**
 * Kept for compatibility with existing media-page gates. Media is always ready
 * from the user's perspective because the backend owns the SurveyCTO credentials.
 */
export function hasValidSurveyCtoSession() {
  clearStoredSurveyCtoSession();
  return true;
}

export function withSurveyCtoSession(url: string) {
  clearStoredSurveyCtoSession();

  // Never send users directly to SurveyCTO. Route SurveyCTO media through our
  // backend so SURVEYCTO_USERNAME/PASSWORD stay server-side on Render.
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase().endsWith(".surveycto.com")) {
        return `/api/main-survey/media-proxy/${encodeURIComponent(url)}`;
      }
    } catch {
      return url;
    }
  }

  return url;
}

/**
 * Legacy compatibility shim. Existing pages may still call this function from
 * old credential-dialog code, but credentials are intentionally never sent or
 * stored. Those dialogs are bypassed because hasValidSurveyCtoSession() is true.
 */
export async function createSurveyCtoSession(
  token: string | null,
  surveyctoUsername: string,
  surveyctoPassword: string,
  formId: string,
) {
  void token;
  void surveyctoUsername;
  void surveyctoPassword;
  void formId;
  clearStoredSurveyCtoSession();
  return { token: "", expiresInSeconds: 0, serverManaged: true };
}
