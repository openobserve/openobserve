// Copyright 2026 OpenObserve Inc.
//
// Extract a display string from a TanStack field's `meta.errors` array.
//
// Per-field validators return plain strings, but a form-level Standard Schema
// (Zod via `<OForm :schema>`) populates the array with raw issue OBJECTS
// (`{ message, path, ... }`). `String(issue)` would render "[object Object]",
// so normalize: strings pass through, issue objects yield their `.message`.

import { inject, type ShallowRef } from "vue";
import { SETTING_ROW_ERROR_KEY } from "./OForm.types";

/** What a field wrapper renders: the red state and the text to print, if any. */
export interface VisibleFieldError {
  invalid: boolean;
  message: string | undefined;
}

/** Fields of a validate-on-leave form that may show their error, and those whose text the group anchor prints. */
export interface LeaveDisplay {
  revealed: ReadonlySet<string>;
  silenced: ReadonlySet<string>;
}

/** Filled by `useOForm` for validate-on-leave forms only; a form absent from it shows every error. */
export const leaveDisplay = new WeakMap<object, ShallowRef<LeaveDisplay>>();

interface FieldLike {
  name: string;
  state: { meta: { errors: readonly unknown[] } };
}

export function firstFieldError(errors: readonly unknown[] | undefined): string | undefined {
  const e = errors?.[0];
  if (e == null) return undefined;
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in (e as object)) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** The one place that decides whether a field shows its error; `rowField` is the field whose message an enclosing row prints. */
export function visibleFieldError(
  form: object,
  field: FieldLike,
  rowField?: string,
): VisibleFieldError {
  const errors = field.state.meta.errors;
  const display = leaveDisplay.get(form)?.value;
  const invalid = errors.length > 0 && (!display || display.revealed.has(field.name));
  const printed = invalid && rowField !== field.name && !display?.silenced.has(field.name);
  return { invalid, message: printed ? firstFieldError(errors) : undefined };
}

/** Setup-time binding of `visibleFieldError` for a field wrapper; call it in the template as `shown(field)`. */
export function useVisibleFieldError(form: object | null) {
  const row = inject(SETTING_ROW_ERROR_KEY, null);
  return (field: FieldLike): VisibleFieldError =>
    form ? visibleFieldError(form, field, row?.name) : { invalid: false, message: undefined };
}

/** Marks a composite control as left once focus moves outside its root, not between its own parts. */
export function leaveOnFocusOut(field: { handleBlur: () => void }, event: FocusEvent) {
  const root = event.currentTarget as Node | null;
  if (!root?.contains(event.relatedTarget as Node | null)) field.handleBlur();
}
