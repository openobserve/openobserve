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

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { EmptyStateKind } from "@/lib/core/EmptyState/OEmptyState.types";

/** One data panel's last load: still running, or finished with or without an error. */
export interface PanelOutcome {
  pending: boolean;
  error: unknown;
}

export interface AllPanelsFailed {
  /** Every panel finished and every one failed: render one page-level state instead of the panels. */
  allFailed: ComputedRef<boolean>;
  /** `denied` when every failure was a 401/403, else `error`; null while any panel is fine or pending. */
  kind: ComputedRef<Extract<EmptyStateKind, "denied" | "error"> | null>;
}

const statusOf = (error: unknown): number | undefined => {
  const e = error as { status?: number; response?: { status?: number } } | null;
  return e?.response?.status ?? e?.status;
};

/** R3 whole-page failure: one page-level OEmptyState when every panel failed, per-panel compact errors otherwise. */
export function useAllPanelsFailed(panels: MaybeRefOrGetter<PanelOutcome[]>): AllPanelsFailed {
  const allFailed = computed(() => {
    const list = toValue(panels);
    return list.length > 0 && list.every((p) => !p.pending && p.error != null);
  });
  const kind = computed(() => {
    if (!allFailed.value) return null;
    const denied = toValue(panels).every((p) => [401, 403].includes(statusOf(p.error) ?? 0));
    return denied ? "denied" : "error";
  });
  return { allFailed, kind };
}
