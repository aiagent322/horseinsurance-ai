/**
 * Service-role modules must stay off the browser graph.
 *
 * This is intentionally not `import "server-only"`. That package throws in
 * standalone Node (`tsx worker/once.ts` / `worker/main.ts`) because it is a
 * Next.js bundler convention, not a Node runtime guard.
 *
 * Runtime: reject browser globals.
 * Static: the service-boundary regression walks client-entry import graphs
 * and fails if they can reach this module or the service-role client.
 */
export function assertServiceRoleModuleAllowed(): void {
  if (typeof window !== "undefined") {
    throw new Error("Service-role client is not available in the browser.");
  }
  if (typeof process === "undefined" || !process.env) {
    throw new Error("Service-role client requires a trusted Node process.");
  }
  const publicServiceRole = Object.keys(process.env).find(
    (key) => key.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE/i.test(key)
  );
  if (publicServiceRole) {
    throw new Error("Service-role credentials must not be exposed through NEXT_PUBLIC_ variables.");
  }
}
