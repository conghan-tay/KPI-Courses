"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

// NEW_DESIGN.md §6.5 — underline tabs, not file folders. The row sits directly
// on the canvas and the panel below is its own surface card, so the tabs cost a
// rule rather than a bordered box. Panel switching is instant.

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Scrolls rather than wraps below `md`: a two-line tab row is broken.
        "flex items-stretch gap-1 overflow-x-auto border-b border-hairline",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "type-label -mb-px cursor-pointer whitespace-nowrap border-b-2 border-transparent px-3.5 py-3 text-ink-muted",
        "transition-colors duration-120 ease-out hover:text-ink",
        "data-active:border-ink data-active:text-ink",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
