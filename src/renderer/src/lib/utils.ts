import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// In-page anchors (#id) would clash with HashRouter, so sections are scrolled to explicitly.
export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
}
