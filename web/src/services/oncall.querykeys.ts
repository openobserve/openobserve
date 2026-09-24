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

import { orgKey } from "@/composables/query/keys";
import { quantizeRange, stableFilters } from "@/composables/query/queryClient";

/**
 * Keys only, dependency-free apart from `orgKey`, so a write in another domain
 * can drop this scope without importing this domain's transport — and so two
 * domains invalidating each other cannot form an import cycle.
 *
 * `all` is the invalidation scope; the rest are entries beneath it. Everything
 * belonging to one team sits under `teams/<id>`, so a team-shaped write drops
 * one prefix rather than naming each read it touched.
 */
export const oncallKeys = {
  all: (org: string) => orgKey(org, "oncall"),

  /** Every team's list and per-team entry — the scope a team write drops. */
  teamsAll: (org: string) => orgKey(org, "oncall", "teams"),
  teams: (org: string) => orgKey(org, "oncall", "teams", "list"),
  /** One team's whole prefix: detail, roster, schedule, policy and everything derived from them. */
  team: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId),
  teamOverview: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId, "overview"),
  teamLoad: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId, "load"),
  teamReachability: (org: string, teamId: string) =>
    orgKey(org, "oncall", "teams", teamId, "reachability"),
  teamRisks: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId, "risks"),
  members: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId, "members"),
  schedule: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId, "schedule"),
  policy: (org: string, teamId: string) => orgKey(org, "oncall", "teams", teamId, "policy"),
  /**
   * `at` omitted asks for "now", which every caller derives from the clock, so
   * it buckets to the minute; a pinned instant (a closed record's `closed_at`)
   * keeps its own entry.
   */
  whoIsOnCall: (org: string, teamId: string, at?: number) =>
    orgKey(
      org,
      "oncall",
      "teams",
      teamId,
      "whoIsOnCall",
      at === undefined ? "now" : quantizeRange(at, at).start,
    ),
  escalationPreview: (org: string, teamId: string, priority?: number) =>
    orgKey(org, "oncall", "teams", teamId, "escalationPreview", priority ?? "default"),
  /** Windowed: both bounds bucket, since the calendar anchors them on the clock. */
  resolvedSchedule: (org: string, teamId: string, from: number, to: number, rotationId?: string) =>
    orgKey(
      org,
      "oncall",
      "teams",
      teamId,
      "resolvedSchedule",
      quantizeRange(from, to),
      rotationId ?? "primary",
    ),
  overrides: (org: string, teamId: string, from?: number, to?: number) =>
    orgKey(
      org,
      "oncall",
      "teams",
      teamId,
      "overrides",
      from === undefined || to === undefined ? "all" : quantizeRange(from, to),
    ),

  /** Who a signal reaches: rules are org-wide, and a team filter is a view of them. */
  ownershipRulesAll: (org: string) => orgKey(org, "oncall", "ownershipRules"),
  ownershipRules: (org: string, teamId?: string) =>
    orgKey(org, "oncall", "ownershipRules", "list", teamId ?? "all"),

  /**
   * Every page the org raised; filters are part of the entry, not of the scope.
   * One page's own reads nest under the same prefix, so a write that moves a
   * response drops the list and that response's detail together — which is what
   * stops a row and the drawer over it disagreeing.
   */
  responsesAll: (org: string) => orgKey(org, "oncall", "responses"),
  responses: (org: string, filters: Record<string, unknown> = {}) =>
    orgKey(org, "oncall", "responses", "list", stableFilters(filters)),
  /** Its own segment: the walk stores `{rows, truncated}`, and `responses` with equal filters stores a bare list. */
  pagedResponses: (org: string, filters: Record<string, unknown> = {}) =>
    orgKey(org, "oncall", "responses", "paged", stableFilters(filters)),
  response: (org: string, responseId: string) => orgKey(org, "oncall", "responses", responseId),
  responseProgress: (org: string, responseId: string) =>
    orgKey(org, "oncall", "responses", responseId, "progress"),
  responsePriorCauses: (org: string, responseId: string) =>
    orgKey(org, "oncall", "responses", responseId, "priorCauses"),
  responseHistory: (org: string, responseId: string, limit?: number) =>
    orgKey(org, "oncall", "responses", responseId, "history", limit ?? "all"),
  responseDeliveries: (org: string, responseId: string, limit?: number, offset?: number) =>
    orgKey(org, "oncall", "responses", responseId, "deliveries", limit ?? "all", offset ?? 0),
  /** Keyed by the incident, not by a response id — the drawer asks the other way round. */
  responsesForIncident: (org: string, incidentId: string) =>
    orgKey(org, "oncall", "responses", "forIncident", incidentId),

  /** What each rule actually caught. Under the rules prefix, so a rule write drops it too. */
  ownershipStats: (org: string, teamId?: string, days?: number) =>
    orgKey(org, "oncall", "ownershipRules", "stats", teamId ?? "all", days ?? "default"),

  /** Signals that matched no rule at all. */
  unroutedAll: (org: string) => orgKey(org, "oncall", "unrouted"),
  unrouted: (org: string, filters: Record<string, unknown> = {}) =>
    orgKey(org, "oncall", "unrouted", "list", stableFilters(filters)),

  /** Org-scoped, deliberately not per team — an absence is the person's, not the roster's. */
  unavailabilityAll: (org: string) => orgKey(org, "oncall", "unavailability"),
  unavailability: (org: string, userEmail?: string, from?: number, to?: number) =>
    orgKey(
      org,
      "oncall",
      "unavailability",
      userEmail ?? "all",
      from === undefined || to === undefined ? "all" : quantizeRange(from, to),
    ),

  /** Server-shipped catalogue of schedule shapes. */
  presets: (org: string) => orgKey(org, "oncall", "presets"),

  /** Org-wide coverage answer — any roster or schedule write can move it. */
  coverageGaps: (org: string) => orgKey(org, "oncall", "coverageGaps"),

  /** The signed-in user's own view; membership and schedule writes move it. */
  myAll: (org: string) => orgKey(org, "oncall", "my"),
  myOnCall: (org: string) => orgKey(org, "oncall", "my", "teams"),
  myDeliveries: (org: string, filters: Record<string, unknown> = {}) =>
    orgKey(org, "oncall", "my", "deliveries", stableFilters(filters)),

  routingConfig: (org: string) => orgKey(org, "oncall", "routing", "config"),
};
