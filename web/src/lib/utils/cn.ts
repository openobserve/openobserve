// Copyright 2026 OpenObserve Inc.
/**
 * cn — merge class values, filtering falsy ones.
 *
 * Lightweight, zero-dependency alternative to clsx + tailwind-merge.
 * Follows the Shadcn / Radix UI convention of accepting the same flexible
 * ClassValue union that clsx supports.
 *
 * Usage:
 *   cn('base', isActive && 'active', { 'text-red': hasError })
 *   cn('tw:flex', props.class)
 */

type ClassRecord = Record<string, boolean | undefined | null>;
type ClassValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | ClassRecord
  | ClassValue[];

function toClass(value: ClassValue): string {
  if (!value && value !== 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(toClass).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .join(" ");
  }
  return "";
}

export function cn(...inputs: ClassValue[]): string {
  return inputs.map(toClass).filter(Boolean).join(" ");
}
