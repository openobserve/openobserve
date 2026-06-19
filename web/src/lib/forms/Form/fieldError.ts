// Copyright 2026 OpenObserve Inc.
//
// Extract a display string from a TanStack field's `meta.errors` array.
//
// Per-field validators return plain strings, but a form-level Standard Schema
// (Zod via `<OForm :schema>`) populates the array with raw issue OBJECTS
// (`{ message, path, ... }`). `String(issue)` would render "[object Object]",
// so normalize: strings pass through, issue objects yield their `.message`.

export function firstFieldError(
  errors: readonly unknown[] | undefined,
): string | undefined {
  const e = errors?.[0];
  if (e == null) return undefined;
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in (e as object)) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
