import { cookies } from "next/headers";

import { findUser, USER_COOKIE, type User } from "@/lib/seed";

/**
 * The signed-in user, as far as the POC is concerned: a cookie naming one of
 * two seeded rows. Every screen reads identity through here, so replacing this
 * with real auth is a one-file change.
 */
export async function getCurrentUser(): Promise<User> {
  const store = await cookies();
  return findUser(store.get(USER_COOKIE)?.value);
}
