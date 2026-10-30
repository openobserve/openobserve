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

import syntheticsService from "@/services/synthetics";
import type { ChildJourney } from "./expandJourney";
import { mapWireSteps } from "./mapRecordedStep";

/** `refused` is a 403, `missing` a 404, `error` anything else (5xx, network). */
export type ChildLoadFailure = "refused" | "missing" | "error";

export type ChildLoadResult =
  { ok: true; child: ChildJourney } | { ok: false; failure: ChildLoadFailure; error: unknown };

/** Reads through the host's one children cache, and writes a loaded child back into it. */
export async function fetchChildJourney(
  org: string,
  id: string,
  cache: Map<string, ChildJourney>,
): Promise<ChildLoadResult> {
  const cached = cache.get(id);
  if (cached) return { ok: true, child: cached };
  try {
    const res = await syntheticsService.get(org, id);
    const data = res.data ?? {};
    const child: ChildJourney = {
      id,
      name: data.name ?? "",
      folderId: data.folder_id,
      steps: mapWireSteps(data.config?.steps ?? []),
    };
    cache.set(id, child);
    return { ok: true, child };
  } catch (error) {
    return { ok: false, failure: childLoadFailure(error), error };
  }
}

function childLoadFailure(error: unknown): ChildLoadFailure {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 403) return "refused";
  if (status === 404) return "missing";
  return "error";
}
