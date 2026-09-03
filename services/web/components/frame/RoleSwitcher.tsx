"use client";

import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

import { signInAs } from "@/app/actions";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { RisoPortrait } from "@/components/kb/RisoPortrait";
import { SEEDED_USERS, type User } from "@/lib/seed";

// POC_UserJourney.md §0 — "Sign in as Candidate / Recruiter", two seeded users,
// no real auth. Switching is a server action (app/actions.ts) that sets the
// cookie `getCurrentUser()` reads, so the re-render already has the new
// identity. Journey 1 only ever needs the candidate.

export function RoleSwitcher({ user }: { user: User }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            disabled={pending}
          />
        }
      >
        <span className="max-sm:hidden">Sign in as</span>
        <span>{user.name}</span>
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Dev mode · no real auth</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SEEDED_USERS.map((seeded) => (
          <DropdownMenuItem
            key={seeded.id}
            onClick={() => startTransition(() => signInAs(seeded.id))}
            className={seeded.id === user.id ? "bg-pink-wash" : undefined}
          >
            <RisoPortrait
              name={seeded.name}
              initials={seeded.initials}
              size="sm"
            />
            <span className="flex flex-col">
              <span>{seeded.name}</span>
              <span className="type-meta text-ink-muted">{seeded.role}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
