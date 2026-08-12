/**
 * Resolve a SurveyCTO attachment field value to a displayable URL.
 *
 * SurveyCTO exports attachment fields as "File skipped from exports: media\filename.ext"
 * when the file was not downloaded inline during the CSV export.  We resolve that to a
 * direct SurveyCTO multimedia API URL so the browser can fetch it — the same way
 * audio_url fields are stored and played back on the Audio Listening page.
 * The browser will challenge with HTTP 401 (Basic Auth) and show the OS credential
 * dialog on the first request; subsequent requests use the cached credentials.
 */
export function resolveMediaSrc(
  ref: string | null | undefined,
  multimediaBaseUrl: string | null | undefined,
): string | null {
  if (!ref) return null;

  // Already a fully-qualified URL — use as-is (covers stored audio_url values)
  if (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("data:")
  ) {
    return ref;
  }

  if (!multimediaBaseUrl) return null;

  // "File skipped from exports: media\filename.ext"
  // or "File skipped from exports: media/filename.ext"
  const skippedMatch = ref.match(/File skipped from exports:\s*(?:media[/\\])?(.+)/i);
  if (skippedMatch) {
    const filename = skippedMatch[1].trim().replace(/\\/g, "/");
    return `${multimediaBaseUrl}/${encodeURIComponent(filename)}`;
  }

  // Bare filename with an image extension
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(ref)) {
    const bare = ref.split(/[/\\]/).pop() ?? ref;
    return `${multimediaBaseUrl}/${encodeURIComponent(bare)}`;
  }

  // Bare filename with an audio extension
  if (/\.(m4a|mp3|ogg|wav|aac|mp4)$/i.test(ref)) {
    const bare = ref.split(/[/\\]/).pop() ?? ref;
    return `${multimediaBaseUrl}/${encodeURIComponent(bare)}`;
  }

  return null;
}
