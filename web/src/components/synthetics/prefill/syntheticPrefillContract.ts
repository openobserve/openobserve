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

// The one swap point for U0's `utils/synthetics/syntheticPrefill.ts`; once it lands this file re-exports it.

export const SYNTHETIC_PREFILL_KEY = "o2:syntheticPrefill";

export interface SyntheticPrefillService {
  name: string;
  cluster: string | null;
  namespace: string | null;
}

export interface SyntheticPrefill {
  version: 1;
  source: "autoobserve";
  sourceLabel: string;
  name: string;
  folder: string;
  type: "http";
  url: string;
  method: "GET";
  locations: string[];
  destinations: string[];
  intervalMinutes: 5;
  tags: string[];
  /** Only the fields AutoObserve inferred; the form marks exactly these as Suggested. */
  suggested: (keyof SyntheticPrefill)[];
  service: SyntheticPrefillService;
}

/** Facts behind the field notes; each is optional so a missing one drops its clause, never the field. */
export interface SyntheticPrefillEvidence {
  reach?: "private" | "public";
  urlFrom?: "traces" | "logs";
  folderAlerts?: number;
  destinationAlerts?: number;
}

export type SyntheticPrefillInput = SyntheticPrefill & { evidence?: SyntheticPrefillEvidence };

export function writeSyntheticPrefill(prefill: SyntheticPrefillInput): void {
  try {
    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // A full or unavailable sessionStorage opens the plain form, which is still correct.
  }
}

/** Reads the stored prefill and clears it, so a reload or a second visit shows the plain form. */
export function takeSyntheticPrefill(): SyntheticPrefillInput | null {
  try {
    const stored = sessionStorage.getItem(SYNTHETIC_PREFILL_KEY);
    sessionStorage.removeItem(SYNTHETIC_PREFILL_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isSyntheticPrefill(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isSyntheticPrefill(value: unknown): value is SyntheticPrefillInput {
  const p = value as Partial<SyntheticPrefillInput> | null;
  return (
    !!p &&
    p.version === 1 &&
    p.source === "autoobserve" &&
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
