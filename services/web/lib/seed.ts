// POC_UserJourney.md §0 — auth is a dev-mode role switcher over two seeded
// users. Real auth is a Monday problem.
//
// Dana Mercado is the specialist from docs/productDocs/fixtures/source.md, so
// the seeded identity and the fixture course belong to the same person.

export type Role = "specialist" | "seeker";

export type User = {
  id: string;
  name: string;
  role: Role;
  initials: string;
  bio: string;
  avatarUrl?: string;
};

export const SEEDED_USERS: User[] = [
  {
    id: "user-dana",
    name: "Dana Mercado",
    role: "specialist",
    initials: "DM",
    bio: "Eleven years selling industrial pumps into procurement departments. Six years running a 30-person B2B services firm. Now fixes pricing for services businesses doing $1M–$20M.",
  },
  {
    id: "user-sam",
    name: "Sam Okonkwo",
    role: "seeker",
    initials: "SO",
    bio: "Runs a 12-person branding studio. Keeps losing deals at the proposal stage.",
  },
];

export const DEFAULT_USER_ID = "user-dana";

export const USER_COOKIE = "kap_user";

export function findUser(id: string | undefined): User {
  return (
    SEEDED_USERS.find((user) => user.id === id) ??
    SEEDED_USERS.find((user) => user.id === DEFAULT_USER_ID)!
  );
}
