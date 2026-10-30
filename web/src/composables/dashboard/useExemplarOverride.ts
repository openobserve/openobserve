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

import { computed, reactive, type ComputedRef, type Ref } from "vue";

/** Scope used in place of a dashboard id for metrics-explorer cards. */
export const EXEMPLAR_EXPLORER_SCOPE = "metrics-explorer";

// Shared across instances so the panel header and the full-screen view of one panel stay in sync.
const overrides = reactive(new Map<string, boolean | null>());

export function exemplarOverrideKey(org: string, scope: string, id: string): string {
  return `o2.exemplars.${org}.${scope}.${id}`;
}

function readStored(key: string): boolean | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

// Plain memo of the first storage read per key; the reactive map above stays the source of truth once written.
const storedOnce = new Map<string, boolean | null>();

export function readExemplarOverride(key: string): boolean | null {
  if (overrides.has(key)) return overrides.get(key) ?? null;
  if (!storedOnce.has(key)) storedOnce.set(key, readStored(key));
  return storedOnce.get(key) ?? null;
}

export function writeExemplarOverride(key: string, on: boolean): void {
  overrides.set(key, on);
  try {
    window.sessionStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Storage can be unavailable (privacy mode, quota); the in-memory override still applies.
  }
}

export function clearExemplarOverride(key: string): void {
  overrides.set(key, null);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing stored means nothing to clear.
  }
}

/** A viewer's session override wins over the saved panel value, which wins over off. */
export function useExemplarOverride(
  key: Ref<string>,
  saved: Ref<boolean | undefined>,
): {
  override: ComputedRef<boolean | null>;
  effective: ComputedRef<boolean>;
  set: (on: boolean) => void;
} {
  const override = computed(() => (key.value ? readExemplarOverride(key.value) : null));
  const effective = computed(() => override.value ?? saved.value ?? false);
  const set = (on: boolean) => {
    if (key.value) writeExemplarOverride(key.value, on);
  };
  return { override, effective, set };
}
