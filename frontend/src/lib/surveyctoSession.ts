import { apiFetch } from "@/lib/api";

const SURVEYCTO_SESSION_KEY = "four_seasons_surveycto_session";
const SURVEYCTO_SESSION_EXPIRES_KEY = "four_seasons_surveycto_session_expires_at";

function clearStoredSurveyCtoSession() {
  sessionStorage.removeItem(SURVEYCTO_SESSION_KEY);
  sessionStorage.removeItem(SURVEYCTO_SESSION_EXPIRES_KEY);
}

export function getSurveyCtoSessionToken() {
  const token = sessionStorage.getItem(SURVEYCTO_SESSION_KEY);
  const expiresAt = Number(sessionStorage.getItem(SURVEYCTO_SESSION_EXPIRES_KEY) ?? "0");
  if (!token || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    clearStoredSurveyCtoSession();
    return null;
  }
  return token;
}

export function clearSurveyCtoSessionToken() {
  clearStoredSurveyCtoSession();
}

export function hasValidSurveyCtoSession() {
  return Boolean(getSurveyCtoSessionToken());
}

export function withSurveyCtoSession(url: string) {
  const token = getSurveyCtoSessionToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}surveycto_session=${encodeURIComponent(token)}`;
}

export async function createSurveyCtoSession(
  token: string | null,
  surveyctoUsername: string,
  surveyctoPassword: string,
) {
  const payload = await apiFetch<{ token: string; expiresInSeconds: number }>(
    "/api/main-survey/surveycto-session",
    {
      method: "POST",
      body: JSON.stringify({ surveyctoUsername, surveyctoPassword }),
    },
    token,
    30_000,
  );
  sessionStorage.setItem(SURVEYCTO_SESSION_KEY, payload.token);
  sessionStorage.setItem(
    SURVEYCTO_SESSION_EXPIRES_KEY,
    String(Date.now() + Math.max(0, payload.expiresInSeconds) * 1000),
  );
  return payload;
}
