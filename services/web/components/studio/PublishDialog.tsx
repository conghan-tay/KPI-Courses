"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Journey 1, step 5: publish and hand back a shareable link.
 *
 * The link points at /k/:slug, which is Journey 2's public page and is not in
 * this PR. Saying so is better than a button that quietly goes nowhere.
 */
export function PublishDialog({
  open,
  url,
  onOpenChange,
}: {
  open: boolean;
  url: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const absolute =
    url && typeof window !== "undefined" ? `${window.location.origin}${url}` : url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>It&apos;s live</DialogTitle>
          <DialogDescription>
            Anyone with this link can argue with you for five turns before they
            have to pay.
          </DialogDescription>
        </DialogHeader>

        <p className="type-meta border-2 border-ink bg-paper-tint px-4 py-3 break-all">
          {absolute}
        </p>

        <p className="type-body-s text-ink-muted">
          That page itself ships with Journey 2 — this link will resolve
          once that lands.
        </p>

        <DialogFooter>
          <Button
            variant="accent"
            onClick={async () => {
              if (!absolute) return;
              await navigator.clipboard.writeText(absolute);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Back to editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
