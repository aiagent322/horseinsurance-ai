export const PRIVATE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Cookie"
};

export function jsonNotFound(): { error: string } {
  return { error: "Not found" };
}
