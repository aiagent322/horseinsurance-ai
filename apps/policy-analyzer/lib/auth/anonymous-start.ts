export type AnonymousAuthClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: { id?: string } | null } | null };
    }>;
    signInAnonymously: () => Promise<{
      data: { session: { user?: { id?: string } | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

export class AnonymousSignInError extends Error {
  constructor(message = "Could not start a demo session.") {
    super(message);
    this.name = "AnonymousSignInError";
  }
}

export async function ensureAnonymousBrowserSession(
  client: AnonymousAuthClient
): Promise<{ userId: string; created: boolean }> {
  const existing = await client.auth.getSession();
  const existingId = existing.data.session?.user?.id;
  if (existingId) {
    return { userId: existingId, created: false };
  }

  const { data, error } = await client.auth.signInAnonymously();
  const userId = data.session?.user?.id;
  if (error || !userId) {
    throw new AnonymousSignInError();
  }
  return { userId, created: true };
}
