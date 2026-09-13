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

import { readonly, ref } from "vue";

import oncallService from "@/services/oncall";
import type { RoutingConfig } from "@/ts/interfaces/oncall";

/**
 * The org's catch-all team, read once and shared.
 *
 * Three components asked for it independently — the card that SETS it, the
 * ownership table that shows it as the last row, and the policy editor, which
 * warns when a ladder ends in `notify_default_team` and nobody is nominated.
 * Two of them render on the Routing screen at the same time, so the same tiny
 * request went out twice and the two copies could disagree the moment one was
 * written: nominating a catch-all left the warning in the drawer still saying
 * there was none, because nothing told it.
 *
 * Module-scoped on purpose. A per-component cache would be three caches again.
 *
 * @example
 * const { config, load, refresh } = useOnCallRoutingConfig();
 * onMounted(() => load(orgId.value));      // no-op if another caller has it
 * await refresh(orgId.value);              // after a write
 */
const config = ref<RoutingConfig | null>(null);
/** Which org the cached value belongs to — switching orgs must not inherit it. */
let loadedFor: string | null = null;
/** In-flight read, so simultaneous callers share one request rather than racing. */
let inFlight: Promise<void> | null = null;

async function read(orgId: string): Promise<void> {
  try {
    const res = await oncallService.getRoutingConfig({ org_identifier: orgId });
    config.value = res.data ?? null;
  } catch {
    // Unset is the honest reading of "could not load": neither state claims a
    // catch-all exists, and a failed read must not make one appear or vanish.
    config.value = null;
  } finally {
    loadedFor = orgId;
    inFlight = null;
  }
}

export function useOnCallRoutingConfig() {
  /** Reads once per org. Callers may all call it; only the first fetches. */
  function load(orgId: string): Promise<void> {
    if (loadedFor === orgId && !inFlight) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = read(orgId);
    return inFlight;
  }

  /** Re-reads unconditionally. Call after writing the config. */
  function refresh(orgId: string): Promise<void> {
    loadedFor = null;
    inFlight = read(orgId);
    return inFlight;
  }

  return { config: readonly(config), load, refresh };
}

/** Test seam — resets the module cache between cases. */
export function __resetOnCallRoutingConfig() {
  config.value = null;
  loadedFor = null;
  inFlight = null;
}
