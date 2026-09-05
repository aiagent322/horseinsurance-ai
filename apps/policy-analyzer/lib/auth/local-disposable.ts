/**
 * Password sign-in is a disposable loopback helper only.
 * Hosted staging and production Auth URLs must never activate it.
 */
export function isLocalDisposableAuthUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}
