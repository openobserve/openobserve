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

import type { LocationQuery, LocationQueryRaw, Router } from "vue-router";

import type { HomePeriod } from "@/composables/contextProviders/homeContextProvider";
import type { HomeReturnState } from "@/composables/goto/homeReturn";

const ROW_PATTERN = /^(incident|service|anomaly|alert):.+$/;
const PERIOD_PATTERN = /^\d+[smhdwM]$/;
const INTEGER = /^\d+$/;
const ORG_QUERY_KEY = "org_identifier";
const OVERVIEW_KEYS = ["row", "period", "from", "to"] as const;

const PERIOD_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 2_592_000_000,
};

/** Home opens on the window its baselines are read against. */
export const DEFAULT_HOME_RANGE: HomeRange = { type: "relative", period: "24h" };

/** The Overview's range as the picker emits it; absolute bounds in microseconds. */
export type HomeRange =
  { type: "relative"; period: string } | { type: "absolute"; from: number; to: number };

/** What the `home` route query restores: the selected row and the range. */
export interface HomeUrlState {
  row: string | null;
  range: HomeRange | null;
}

/** Reads `row`, `period` or `from` + `to`; a malformed value restores nothing for that part. */
export function readHomeUrl(query: LocationQuery): HomeUrlState {
  const row = single(query.row);
  return { row: row && ROW_PATTERN.test(row) ? row : null, range: rangeOf(query) };
}

/** The route query with the Overview keys replaced; other keys keep their order and `org_identifier` stays last. */
export function homeUrlQuery(query: LocationQuery, state: HomeUrlState): LocationQueryRaw {
  const { [ORG_QUERY_KEY]: org, ...rest } = query as LocationQueryRaw;
  for (const key of OVERVIEW_KEYS) delete rest[key];
  const next: LocationQueryRaw = { ...rest };
  if (state.row) next.row = state.row;
  if (state.range?.type === "relative") next.period = state.range.period;
  if (state.range?.type === "absolute") {
    next.from = String(state.range.from);
    next.to = String(state.range.to);
  }
  if (org !== undefined) next[ORG_QUERY_KEY] = org;
  return next;
}

/** The `home_return` state of the Overview as it stands, for a trip away from it. */
export function homeReturnState(state: HomeUrlState, focus?: "ask"): HomeReturnState {
  const out: HomeReturnState = {};
  if (state.row) out.row = state.row;
  if (state.range?.type === "relative") out.period = state.range.period;
  if (state.range?.type === "absolute") {
    out.from = state.range.from;
    out.to = state.range.to;
  }
  if (focus) out.focus = focus;
  return out;
}

/** Writes the state with `router.replace`, so restoring a range never adds a history entry; off `home` it does nothing. */
export function writeHomeUrl(
  router: Pick<Router, "replace" | "currentRoute">,
  state: HomeUrlState,
): void {
  const route = router.currentRoute.value;
  if (route.name !== "home") return;
  const query = homeUrlQuery(route.query, state);
  if (sameQuery(route.query, query)) return;
  void router.replace({ name: "home", query }).catch(() => undefined);
}

function single(value: LocationQuery[string] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first !== "" ? first : null;
}

function rangeOf(query: LocationQuery): HomeRange | null {
  const period = single(query.period);
  const from = single(query.from);
  const to = single(query.to);
  if (period !== null) {
    return from === null && to === null && PERIOD_PATTERN.test(period)
      ? { type: "relative", period }
      : null;
  }
  if (from === null || to === null || !INTEGER.test(from) || !INTEGER.test(to)) return null;
  const start = Number(from);
  const end = Number(to);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) return null;
  return { type: "absolute", from: start, to: end };
}

function sameQuery(a: LocationQuery, b: LocationQueryRaw): boolean {
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  return keys.every((key, index) => Object.keys(a)[index] === key && a[key] === b[key]);
}

/** Milliseconds of a relative period such as `15m` or `24h`; an unreadable one is 15 minutes. */
export function periodToMs(period: string): number {
  const match = /^(\d+)([smhdwM])$/.exec(period);
  return match ? Number(match[1]) * PERIOD_UNIT_MS[match[2]] : 15 * 60_000;
}

/** The period the assistant reads a relative Home range as; `null` for an absolute one. */
export function homePeriodOf(range: HomeRange): HomePeriod | null {
  return range.type === "relative" ? { period: range.period, ms: periodToMs(range.period) } : null;
}
