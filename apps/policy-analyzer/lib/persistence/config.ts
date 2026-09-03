export class ConfigurationError extends Error {
  constructor(message = "Analyzer persistence is not configured.") {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isFixtureAnalysisEnabled(): boolean {
  if (isProduction()) return process.env.ENABLE_FIXTURE_ANALYSIS === "true";
  return process.env.ENABLE_FIXTURE_ANALYSIS !== "false";
}

export function retentionDays(): number {
  const raw = process.env.POLICY_RETENTION_DAYS;
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  if (isProduction()) {
    throw new ConfigurationError("POLICY_RETENTION_DAYS is required in production.");
  }
  return 30;
}

export function retentionExpiresAt(from = new Date()): string {
  const ms = retentionDays() * 24 * 60 * 60 * 1000;
  return new Date(from.getTime() + ms).toISOString();
}

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

export function supabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY
  );
}

export function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export function requireSupabaseConfig(): { url: string; anonKey: string } {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) throw new ConfigurationError();
  return { url, anonKey };
}

export function serviceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}
