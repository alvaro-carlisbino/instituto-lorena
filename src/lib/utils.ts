import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Gera identificador estável (minúsculas, hífens) a partir de um rótulo humano. */
export function slugifyLabel(label: string, fallback = "campo"): string {
  const s = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s.length > 0 ? s.slice(0, 64) : fallback
}
