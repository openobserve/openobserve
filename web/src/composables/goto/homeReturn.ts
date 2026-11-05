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

import type { LocationQueryRaw, RouteLocationRaw } from "vue-router";

import type { Sid } from "@/composables/assistant/pure";

export const HOME_RETURN_QUERY_KEY = "home_return";

const ROW_PATTERN = /^(incident|service|anomaly|alert):.+$/;
const PERIOD_PATTERN = /^\d+[smhdwM]$/;
const ORG_QUERY_KEY = "org_identifier";

// Per tab on purpose: the return target belongs to the tab that ran the Investigate.
const armed = new Map<Sid, HomeReturnState>();

/** Where "Back to Overview" lands: the row, the range (`period`, or `from` + `to` in µs) and whether to focus the ask field. */
export interface HomeReturnState {
  row?: string;
  period?: string;
  from?: number;
  to?: number;
  focus?: "ask";
}

/** A URLSearchParams string, so the whole state rides in one query value. */
export function encodeHomeReturn(state: HomeReturnState): string {
  const params = new URLSearchParams();
  if (state.row) params.set("row", state.row);
  if (state.period) params.set("period", state.period);
  if (state.from !== undefined) params.set("from", String(state.from));
  if (state.to !== undefined) params.set("to", String(state.to));
  if (state.focus) params.set("focus", state.focus);
  return params.toString();
}

/** Null on anything malformed, so a pasted or edited link never restores half a state. */
export function decodeHomeReturn(value: unknown): HomeReturnState | null {
  if (typeof value !== "string") return null;
  const params = new URLSearchParams(value);
  const state: HomeReturnState = {};
  const row = params.get("row");
  if (row !== null) {
    if (!ROW_PATTERN.test(row)) return null;
    state.row = row;
  }
  const range = decodeRange(params);
  if (range === null) return null;
  Object.assign(state, range);
  const focus = params.get("focus");
  if (focus !== null) {
    if (focus !== "ask") return null;
    state.focus = "ask";
  }
  return state;
}

/** Adds `home_return` to a target location; `org_identifier` stays the last query key. */
export function withHomeReturn(
  location: RouteLocationRaw,
  state: HomeReturnState,
): RouteLocationRaw {
  const encoded = encodeHomeReturn(state);
  if (typeof location === "string") return withQueryString(location, encoded);
  const { [ORG_QUERY_KEY]: org, ...rest } = (location.query ?? {}) as LocationQueryRaw;
  const query: LocationQueryRaw = { ...rest, [HOME_RETURN_QUERY_KEY]: encoded };
  if (org !== undefined) query[ORG_QUERY_KEY] = org;
  return { ...location, query };
}

/** Remembers, for this tab only, where a chat started from the Overview should return to. */
export function armHomeReturn(sid: Sid, state: HomeReturnState): void {
  armed.set(sid, { ...state });
}

export function homeReturnFor(sid: Sid): HomeReturnState | null {
  const state = armed.get(sid);
  return state ? { ...state } : null;
}

// `period` and `from`/`to` are exclusive, and a range needs both ends in order.
function decodeRange(
  params: URLSearchParams,
): Pick<HomeReturnState, "period" | "from" | "to"> | null {
  const period = params.get("period");
  const from = params.get("from");
  const to = params.get("to");
  if (period !== null) {
    if (from !== null || to !== null || !PERIOD_PATTERN.test(period)) return null;
    return { period };
  }
  if (from === null && to === null) return {};
  const start = Number(from);
  const end = Number(to);
  const valid = from !== null && to !== null && /^\d+$/.test(from) && /^\d+$/.test(to);
  if (!valid || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end)
    return null;
  return { from: start, to: end };
}

function withQueryString(path: string, encoded: string): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = base.indexOf("?");
  const pathname = queryAt >= 0 ? base.slice(0, queryAt) : base;
  const params = new URLSearchParams(queryAt >= 0 ? base.slice(queryAt + 1) : "");
  const org = params.get(ORG_QUERY_KEY);
  params.delete(ORG_QUERY_KEY);
  params.set(HOME_RETURN_QUERY_KEY, encoded);
  if (org !== null) params.set(ORG_QUERY_KEY, org);
  return `${pathname}?${params.toString()}${hash}`;
}
