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

import type { BrowserStep } from "@/types/synthetics";
import { placeholdersIn } from "./expandJourney";

export { placeholdersIn };

const REFERENCED_REASON: Record<Exclude<ReferencedByState, "none">, ExtractReason> = {
  some: "referenced",
  pending: "referenced-pending",
  unknown: "referenced-unknown",
};

export type ExtractReason =
  | "not-contiguous"
  | "not-contiguous-filtered"
  | "contains-subtest"
  | "referenced"
  | "referenced-pending"
  | "referenced-unknown"
  | "undefined-placeholder";

export type ReferencedByState = "none" | "some" | "pending" | "unknown";

export interface ExtractEligibilityInput {
  steps: BrowserStep[];
  selectedIds: ReadonlySet<string>;
  filterActive: boolean;
  referencedBy: ReferencedByState;
  definedNames: ReadonlySet<string>;
}

export type ExtractEligibility =
  | { ok: true; range: BrowserStep[]; anchor: number }
  | { ok: false; reason: ExtractReason; placeholder?: string };

/** PRD §14.4 rules 3–7 in precedence order; judged against the model, never the rendered rows. */
export function extractEligibility(input: ExtractEligibilityInput): ExtractEligibility {
  const { steps, selectedIds, filterActive, referencedBy, definedNames } = input;
  const indices = steps.flatMap((s, i) => (selectedIds.has(s.id) ? [i] : []));
  const anchor = indices[0] ?? -1;
  const contiguous = indices.length > 0 && indices.every((idx, k) => idx === anchor + k);
  if (!contiguous) {
    return { ok: false, reason: filterActive ? "not-contiguous-filtered" : "not-contiguous" };
  }
  const range = steps.slice(anchor, anchor + indices.length);
  if (range.some((s) => s.action === "subtest")) return { ok: false, reason: "contains-subtest" };
  if (referencedBy !== "none") return { ok: false, reason: REFERENCED_REASON[referencedBy] };
  const missing = placeholdersIn(range).find((name) => !definedNames.has(name));
  if (missing !== undefined) {
    return { ok: false, reason: "undefined-placeholder", placeholder: missing };
  }
  return { ok: true, range, anchor };
}
