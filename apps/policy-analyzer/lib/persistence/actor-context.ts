import { AsyncLocalStorage } from "node:async_hooks";
import { AuthRequiredError } from "./config";
import type { Actor } from "./types";

const storage = new AsyncLocalStorage<Actor>();

export const TEST_ACTOR_A: Actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: "owner",
  email: "owner-a@example.com"
};

export const TEST_ACTOR_B: Actor = {
  userId: "22222222-2222-4222-8222-222222222222",
  accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "owner",
  email: "owner-b@example.com"
};

export function runWithActor<T>(actor: Actor, fn: () => T): T {
  return storage.run(actor, fn);
}

export function actorFromContext(): Actor | undefined {
  return storage.getStore();
}

export function requireContextActor(): Actor {
  const actor = storage.getStore();
  if (!actor) throw new AuthRequiredError();
  return actor;
}
