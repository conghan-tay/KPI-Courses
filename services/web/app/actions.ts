"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { findUser, USER_COOKIE } from "@/lib/seed";

/**
 * The dev-mode role switcher from POC_UserJourney.md §0.
 *
 * Setting the cookie on the server rather than from `document.cookie` keeps one
 * source of truth — `getCurrentUser()` reads the same cookie — and means the
 * re-render happens with the new identity already in place.
 */
export async function signInAs(userId: string) {
  const user = findUser(userId);
  const store = await cookies();

  store.set(USER_COOKIE, user.id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  revalidatePath("/", "layout");
}
