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

import { computed, type ComputedRef } from "vue";

import { leaveDisplay, visibleFieldError } from "@/lib/forms/Form/fieldError";

type FieldMetaMap = Record<string, { errors?: readonly unknown[] } | undefined>;

interface StoreForm {
  useStore: <R>(_selector: (_state: any) => R) => { readonly value: R };
}

/** The message a field's own wrapper would show now, for a step that prints it outside the field. */
export function shownFieldError(
  form: StoreForm | null | undefined,
  name: string,
): ComputedRef<string | undefined> {
  if (!form) return computed(() => undefined);
  const errors = form.useStore((s) => (s.fieldMeta?.[name]?.errors ?? []) as readonly unknown[]);
  return computed(
    () => visibleFieldError(form, { name, state: { meta: { errors: errors.value } } }).message,
  );
}

/** The form's field meta, keeping only the errors its fields show now. */
export function shownFieldMeta(form: StoreForm): ComputedRef<FieldMetaMap> {
  const meta = form.useStore((s) => (s.fieldMeta ?? {}) as FieldMetaMap);
  return computed(() => {
    const display = leaveDisplay.get(form)?.value;
    if (!display) return meta.value;
    return Object.fromEntries(
      Object.entries(meta.value).filter(([name]) => display.revealed.has(name)),
    );
  });
}
