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

import {
  takeSyntheticPrefill as takeStoredPrefill,
  type SyntheticPrefillInput,
} from "@/utils/synthetics/syntheticPrefill";

export {
  SYNTHETIC_PREFILL_KEY,
  writeSyntheticPrefill,
  type SyntheticPrefill,
  type SyntheticPrefillEvidence,
  type SyntheticPrefillInput,
  type SyntheticPrefillService,
} from "@/utils/synthetics/syntheticPrefill";

/** U0's read-once take, narrowed to a prefill whose lists the form can fill without a guard per field. */
export function takeSyntheticPrefill(): SyntheticPrefillInput | null {
  const stored = takeStoredPrefill();
  return stored && isSyntheticPrefill(stored) ? stored : null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isSyntheticPrefill(value: unknown): value is SyntheticPrefillInput {
  const p = value as Partial<SyntheticPrefillInput> | null;
  return (
    !!p &&
    p.type === "http" &&
    typeof p.name === "string" &&
    typeof p.folder === "string" &&
    typeof p.url === "string" &&
    typeof p.intervalMinutes === "number" &&
    isStringList(p.locations) &&
    isStringList(p.destinations) &&
    isStringList(p.tags) &&
    isStringList(p.suggested) &&
    typeof p.service?.name === "string" &&
    p.service.name.length > 0
  );
}
