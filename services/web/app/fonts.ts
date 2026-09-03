import { Geist, Geist_Mono } from "next/font/google";

// NEW_DESIGN.md §3 — one family. Hierarchy is size, weight and tracking, never a
// family change. Geist is the free substitute the brief names for Saans: a
// geometric grotesk that reads confident at 500 without going bold.
//
// Geist Mono appears in exactly one place — section ids, which the candidate has
// to compare character by character. Not on counts, not on timestamps, not on
// status. Mono is information here, not texture.

export const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const fontVariables = `${geist.variable} ${geistMono.variable}`;
