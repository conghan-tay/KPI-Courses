import { Archivo, DM_Mono, Newsreader } from "next/font/google";

// DESIGN.md §3 — three families, each with a job. The split is semantic, not
// decorative: the candidate's words are serif, the application's own voice is
// grotesk, and anything that is a number is mono.

export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const newsreader = Newsreader({
  subsets: ["latin"],
  // Italic carries the `pushback` quotes and citation expansions.
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

export const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const fontVariables = `${archivo.variable} ${newsreader.variable} ${dmMono.variable}`;
