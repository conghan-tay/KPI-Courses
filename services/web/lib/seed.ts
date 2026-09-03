// POC_UserJourney.md §0 — auth is a dev-mode role switcher over two seeded
// users. LinkedIn OAuth, the email approve/reject loop and magic links are all
// real-auth problems, deferred.
//
// Arun Velasco is the candidate from docs/productDocs/fixtures/, so the seeded
// identity and the fixture knowledge base belong to the same person.

export type Role = "candidate" | "recruiter";

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
    id: "user-arun",
    name: "Arun Velasco",
    role: "candidate",
    initials: "AV",
    bio: "Payments engineer. Five and a half years on supplier payouts at Agoda: virtual card issuance, PSP failover, nightly reconciliation. Eleven years, four employers, one gap he will tell you about.",
  },
  {
    id: "user-priya",
    name: "Priya Raman",
    role: "recruiter",
    initials: "PR",
    bio: "Technical recruiting for a card issuer. Screens twelve backend engineers a week and would rather screen three.",
  },
];

export const DEFAULT_USER_ID = "user-arun";

export const USER_COOKIE = "tri_user";

export function findUser(id: string | undefined): User {
  return (
    SEEDED_USERS.find((user) => user.id === id) ??
    SEEDED_USERS.find((user) => user.id === DEFAULT_USER_ID)!
  );
}
