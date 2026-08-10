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

/**
 * Cache tiers — the only place `staleTime`/`gcTime` numbers live. A page picks
 * a tier; it does not pick numbers. If no tier fits, extend this file rather
 * than inlining a `staleTime` at the call site.
 */

import type { QueryPersister } from "@tanstack/query-core";
import { localPersister, idbPersister } from "./persisters";

export type PersistTarget = "none" | "local" | "idb";

interface TierDefinition {
  staleTime: number;
  gcTime: number;
  refetchOnWindowFocus: boolean;
  persist: PersistTarget;
}

export const TIER = {
  /** T0 — immutable for the session: /config, build info, roles enum, built-in patterns. */
  SESSION_STATIC: {
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    persist: "local",
  },
  /** T1 — org configuration: stream names, folders, functions, destinations, templates. */
  ORG_CONFIG: {
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    persist: "local",
  },
  /** T2 — entity lists: alerts, dashboards, reports, pipelines, users. */
  ENTITY_LIST: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    persist: "none",
  },
  /** T3 — a single entity: one dashboard, one alert, one pipeline. */
  ENTITY_DETAIL: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    persist: "none",
  },
  /** T4 — volatile operational state: running queries, job progress, polls. */
  VOLATILE: {
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
    persist: "none",
  },
  /** T5 — heavy result payloads: panel results, field values, trace DAGs. */
  HEAVY_RESULT: {
    staleTime: 0,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    persist: "idb",
  },
} as const satisfies Record<string, TierDefinition>;

export type TierName = keyof typeof TIER;

export interface TierOverrides {
  /**
   * Force persistence off (or on) for one query. Off is required for anything
   * carrying secrets — ingestion tokens, passcodes, cipher key material —
   * which are org config by shape but must stay memory-only.
   */
  persist?: PersistTarget;
}

// `persisterFn` types its context with `pageParam`/`direction` optional, while
// the options it is handed to declare both required. Same function either way;
// the cast is what lets it cross.
type AnyPersister = QueryPersister<any, any, any>;

const persisterFor = (target: PersistTarget): AnyPersister | undefined => {
  if (target === "local") return localPersister.persisterFn as AnyPersister;
  if (target === "idb") return idbPersister.persisterFn as AnyPersister;
  return undefined;
};

/**
 * Expand a tier into the query options it stands for. `refetchOnReconnect` and
 * `retry` come from the client defaults — a tier only overrides what it owns.
 */
export const tierOptions = (tier: TierName, overrides: TierOverrides = {}) => {
  const def = TIER[tier] as TierDefinition;
  const persist = overrides.persist ?? def.persist;
  return {
    staleTime: def.staleTime,
    gcTime: def.gcTime,
    refetchOnWindowFocus: def.refetchOnWindowFocus,
    persister: persisterFor(persist),
  };
};
