export function assertSameOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return site === "none" || site === "same-site";
  try {
    const allowed = new URL(req.url).origin;
    return origin === allowed;
  } catch {
    return false;
  }
}
