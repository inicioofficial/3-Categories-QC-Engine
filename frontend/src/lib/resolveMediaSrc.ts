/**
 * Resolve a SurveyCTO attachment field value to a displayable URL.
 *
 * All SurveyCTO media is routed through the application backend. The backend
 * authenticates to SurveyCTO with SURVEYCTO_USERNAME and SURVEYCTO_PASSWORD
 * from the server environment, so browsers never receive or prompt for those
 * credentials.
 */
function proxySurveyCtoUrl(url: string): string {
  if (url.startsWith("/api/main-survey/media-proxy/")) return url;
  return `/api/main-survey/media-proxy/${encodeURIComponent(url)}`;
}

export function resolveMediaSrc(
  ref: string | null | undefined,
  multimediaBaseUrl: string | null | undefined,
): string | null {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("/api/main-survey/media-proxy/")) return raw;

  // Existing SurveyCTO URLs must never be loaded directly in the browser.
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname.toLowerCase().endsWith(".surveycto.com")) {
        return proxySurveyCtoUrl(raw);
      }
    } catch {
      return null;
    }
    // Preserve non-SurveyCTO absolute media URLs.
    return raw;
  }

  // "File skipped from exports: media\\filename.ext"
  // or "File skipped from exports: media/filename.ext"
  const skippedMatch = raw.match(/File skipped from exports:\s*(?:media[/\\])?(.+)/i);
  const normalized = (skippedMatch?.[1] ?? raw).trim().replace(/\\/g, "/");
  const bare = normalized.split("/").pop() ?? normalized;

  if (!/\.(jpe?g|png|gif|webp|bmp|m4a|mp3|ogg|wav|aac|mp4)$/i.test(bare)) {
    return null;
  }

  if (multimediaBaseUrl) {
    const base = multimediaBaseUrl.replace(/\/$/, "");
    if (base.startsWith("/api/main-survey/media-proxy/")) {
      return `${base}/${encodeURIComponent(bare)}`;
    }
    return proxySurveyCtoUrl(`${base}/${encodeURIComponent(bare)}`);
  }

  // Fallback for records that already carry only a filename. The backend will
  // authenticate using its Render environment credentials.
  return proxySurveyCtoUrl(bare);
}
