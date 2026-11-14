// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { getBy } from "@tanstack/form-core";
import { computed, type ComputedRef, type Ref } from "vue";
import { visibleFieldError } from "../Form/fieldError";

interface CountedFieldMeta {
  isDefaultValue: boolean;
  errors: readonly unknown[];
}

interface CountedFormState {
  values: unknown;
  fieldMeta: Record<string, CountedFieldMeta | undefined>;
}

// Structural, so a form typed for any page's values is accepted.
interface CountedForm {
  useStore: <R>(_selector: (_state: any) => R) => Readonly<Ref<R>>;
  options: { defaultValues?: unknown };
}

const isScalar = (v: unknown) => v == null || typeof v === "string" || typeof v === "number";
const asText = (v: unknown) => (v == null ? "" : String(v));

// A number input hands back text, so "30" over a saved 30, or "" over a saved null, is the saved value.
function sameAsSaved(value: unknown, saved: unknown) {
  return isScalar(value) && isScalar(saved) && asText(value) === asText(saved);
}

/** Live counts for a save bar and a leave guard: fields that differ from the saved values, and fields printing an error. */
export function useFormCounts(form: CountedForm | null | undefined): {
  changes: ComputedRef<number>;
  errors: ComputedRef<number>;
} {
  const values = form?.useStore((s: CountedFormState) => s.values);
  const fieldMeta = form?.useStore((s: CountedFormState) => s.fieldMeta);
  const fields = computed(() => Object.entries(fieldMeta?.value ?? {}));

  const changes = computed(
    () =>
      fields.value.filter(
        ([name, meta]) =>
          meta &&
          !meta.isDefaultValue &&
          !sameAsSaved(getBy(values?.value, name), getBy(form?.options.defaultValues, name)),
      ).length,
  );

  // A coupled group marks every member but prints one message, so it is one field to fix.
  const errors = computed(
    () =>
      fields.value.filter(
        ([name, meta]) =>
          meta && form && visibleFieldError(form, { name, state: { meta } }).message !== undefined,
      ).length,
  );

  return { changes, errors };
}

// Structural for the same reason as CountedForm.
interface RebasableForm {
  state: {
    values: unknown;
    fieldMeta: Record<string, unknown>;
    isSubmitting?: boolean;
    submissionAttempts?: number;
  };
  reset: (_values?: any) => void;
  setFieldValue: (_name: any, _value: any, _opts?: { dontUpdateMeta?: boolean }) => void;
  setFieldMeta: (_name: any, _updater: (_meta: any) => any) => void;
}

// What a Discard left in a form whose save was still open. A reset zeroes the form's submit count.
const discardedWhileSaving = new WeakMap<object, unknown>();

/** Discards a form's edits. A save still open then lands as the baseline without bringing them back. */
export function discardFormChanges(form: RebasableForm, values?: unknown) {
  const saving = !!form.state.isSubmitting;
  form.reset(values);
  if (saving) discardedWhileSaving.set(form, form.state.values);
  else discardedWhileSaving.delete(form);
}

/** After a save: `saved` becomes the baseline, and fields edited since `submitted` keep their newer value as changes. */
export function rebaseSavedValues<T extends Record<string, unknown>>(
  form: RebasableForm,
  saved: T,
  submitted: T,
) {
  const current = form.state.values as T;
  // A submit started after the Discard counts again, so only this save's own Discard is honoured.
  const discarded = form.state.submissionAttempts ? undefined : discardedWhileSaving.get(form);
  discardedWhileSaving.delete(form);
  const text = (from: unknown, path: string) => JSON.stringify(getBy(from, path));
  const editedSince = (paths: string[]) =>
    paths.filter(
      (path) =>
        text(current, path) !== text(submitted, path) &&
        (discarded === undefined || text(current, path) !== text(discarded, path)),
    );
  // Registered fields are paths such as "lockout.start_secs"; a parent goes before its children.
  const registered = Object.keys(form.state.fieldMeta);
  const fields = editedSince(registered).sort((a, b) => a.length - b.length);
  // A key whose leaves are fields is rebased leaf by leaf, or one edited leaf would bring its siblings back.
  const ownedByFields = (key: string) =>
    registered.some(
      (path) => path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`),
    );
  const unregistered = editedSince(Object.keys(submitted).filter((key) => !ownedByFields(key)));

  form.reset(saved);
  // Values no field owns come back whole, without meta: a meta entry would count as one more field.
  for (const key of unregistered) form.setFieldValue(key, current[key], { dontUpdateMeta: true });
  for (const path of fields) {
    form.setFieldValue(path, getBy(current, path));
    // The submit had revealed every error and the reset hid them again; an unfixed kept edit still shows its own.
    form.setFieldMeta(path, (meta) => ({ ...meta, isBlurred: true }));
  }
}
