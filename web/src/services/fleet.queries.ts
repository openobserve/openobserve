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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import fleet, {
  type FleetAuditList,
  type FleetCollector,
  type FleetConfigDetail,
  type FleetConfigIssues,
  type FleetConfigItem,
  type FleetConfigVersion,
  type FleetPipelines,
  type FleetFlowWindow,
  type FleetPlanPreview,
  type FleetPublished,
  type FleetCollectorDetail,
  type FleetCreateTokenRequest,
  type FleetCreatedToken,
  type Fleet,
  type FleetOrgSettings,
  type FleetRollout,
  type FleetSetDesiredRequest,
  type FleetSettings,
  type FleetSummary,
  type FleetToken,
} from "./fleet";
import { fleetKeys } from "./fleet.querykeys";
import searchService from "./search";
import {
  collectorTileQueries,
  type CollectorMetricTile,
  type CollectorMetricValues,
} from "@/components/fleet/collectorMetrics";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { queryClient } from "@/composables/query/queryClient";

// Delivery and rollout state move without any write from this tab, so the views poll while they do.
const DELIVERY_POLL_MS = 5000;

// Push (30 s) plus ingest plus this poll must stay under the 60 s freshness promise for pipeline throughput.
export const FLOW_POLL_MS = 15_000;

const inFlight = (delivery: string | null | undefined) =>
  delivery === "assigned" || delivery === "sent" || delivery === "accepted";

// A scheduled rollout changes only when it becomes due, so a slow poll is enough to wake its row.
const SCHEDULED_POLL_MS = 60_000;

// An auto-rollback commits in its own transaction after the halt, so the halt is not the last word.
const rollbackOwed = (r: Pick<FleetRollout, "auto_rollback" | "halt">) =>
  r.auto_rollback && !!r.halt && r.halt.class !== "cannot_see";

const rolloutMoving = (r: Pick<FleetRollout, "status" | "auto_rollback" | "halt">) =>
  r.status === "in_progress" || (r.status === "halted" && rollbackOwed(r));

const rolloutPoll = (rollouts: FleetRollout[]) => {
  if (rollouts.some(rolloutMoving)) return DELIVERY_POLL_MS;
  return rollouts.some((r) => r.status === "scheduled") ? SCHEDULED_POLL_MS : false;
};

const fleetPoll = (fleets: Fleet[]) => {
  const statuses = fleets.map((f) => f.state?.rollout?.status);
  // The fleet state cannot tell whether an auto-rollback is owed, so a halted fleet keeps polling.
  if (statuses.includes("in_progress") || statuses.includes("halted")) return DELIVERY_POLL_MS;
  return statuses.includes("scheduled") ? SCHEDULED_POLL_MS : false;
};

export interface BulkResult {
  succeeded: string[];
  failed: string[];
  firstError: unknown;
}

/** Runs one call per id; throws only when every call failed. */
async function settleAll(ids: string[], call: (id: string) => Promise<unknown>) {
  const results = await Promise.allSettled(ids.map(call));
  const succeeded = ids.filter((_, i) => results[i].status === "fulfilled");
  const failed = ids.filter((_, i) => results[i].status === "rejected");
  const firstError =
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined)?.reason ??
    null;
  if (!succeeded.length && failed.length) throw firstError;
  return { succeeded, failed, firstError } satisfies BulkResult;
}

export const collectorsInFlight = (collectors: FleetCollector[] | undefined) =>
  !!collectors?.some((c) => inFlight(c.delivery));

export const fleetCollectorsQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.collectors(org),
    queryFn: async (): Promise<FleetCollector[]> => {
      const items = (await fleet.listCollectors(org)).data?.items;
      if (!Array.isArray(items)) throw new Error("Malformed fleet collectors response");
      return items;
    },
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) =>
      collectorsInFlight(query.state.data) ||
      queryClient.getQueryData<FleetRollout[]>(fleetKeys.rollouts(org))?.some(rolloutMoving)
        ? DELIVERY_POLL_MS
        : false,
  });

export const fleetCollectorQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: fleetKeys.collector(org, id),
    queryFn: async (): Promise<FleetCollectorDetail> => (await fleet.getCollector(org, id)).data,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => (inFlight(query.state.data?.delivery) ? DELIVERY_POLL_MS : false),
  });

async function instantValue(org: string, query: string): Promise<number | null> {
  const body = (
    await searchService.metrics_query({
      org_identifier: org,
      // metrics_query interpolates the query raw into the URL.
      query: encodeURIComponent(query),
      end_time: Date.now() * 1000,
    })
  ).data;
  if (body?.status !== "success" || !Array.isArray(body?.data?.result)) {
    throw new Error("Malformed PromQL response");
  }
  const value = Number(body.data.result[0]?.value?.[1]);
  return Number.isFinite(value) ? value : null;
}

/** The tile values: null where the collector reported no series. */
export const fleetCollectorMetricsQuery = (org: string, id: string, window: FleetFlowWindow) =>
  queryOptions({
    queryKey: fleetKeys.collectorMetrics(org, id, window),
    queryFn: async (): Promise<CollectorMetricValues> => {
      const entries = Object.entries(collectorTileQueries(id, window)) as [
        CollectorMetricTile,
        string,
      ][];
      const values = await Promise.all(entries.map(([, q]) => instantValue(org, q)));
      return Object.fromEntries(
        entries.map(([tile], i) => [tile, values[i]]),
      ) as CollectorMetricValues;
    },
    staleTime: LIVE_STALE_TIME,
  });

/** `delivering` comes from the caller, since another query's cache change never re-evaluates this interval. */
export const fleetSummaryQuery = (org: string, delivering = false) =>
  queryOptions({
    queryKey: fleetKeys.summary(org),
    queryFn: async (): Promise<FleetSummary> => (await fleet.summary(org)).data,
    staleTime: LIVE_STALE_TIME,
    // A list cache no active view refreshes would otherwise keep this polling forever.
    refetchInterval: (query) =>
      (delivering &&
        !!queryClient
          .getQueryCache()
          .find({ queryKey: fleetKeys.collectors(org), exact: true })
          ?.isActive()) ||
      (query.state.data?.rollouts_active ?? 0) > 0
        ? DELIVERY_POLL_MS
        : false,
  });

export const fleetTokensQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.tokens(org),
    queryFn: async (): Promise<FleetToken[]> => {
      const items = (await fleet.listTokens(org)).data?.items;
      if (!Array.isArray(items)) throw new Error("Malformed fleet tokens response");
      return items;
    },
    staleTime: LIVE_STALE_TIME,
  });

export const fleetsQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.fleets(org),
    queryFn: async (): Promise<Fleet[]> => {
      const items = (await fleet.listFleets(org)).data?.items;
      if (!Array.isArray(items)) throw new Error("Malformed fleets response");
      return items;
    },
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => fleetPoll(query.state.data ?? []),
  });

export const fleetSettingsOfQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: fleetKeys.fleetSettings(org, id),
    queryFn: async (): Promise<FleetSettings> => (await fleet.getFleetSettings(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

/** The plan the server would cut for this request; keyed by the body so each edit reads once. */
export const fleetPlanPreviewQuery = (org: string, id: string, body: FleetSetDesiredRequest) =>
  queryOptions({
    queryKey: fleetKeys.preview(org, id, JSON.stringify(body)),
    queryFn: async (): Promise<FleetPlanPreview> =>
      (await fleet.previewDesired(org, id, body)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const fleetConfigsQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.configs(org),
    queryFn: async (): Promise<FleetConfigItem[]> => {
      const items = (await fleet.listConfigs(org)).data?.items;
      if (!Array.isArray(items)) throw new Error("Malformed fleet configs response");
      return items;
    },
    staleTime: LIVE_STALE_TIME,
  });

export const fleetConfigQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: fleetKeys.config(org, id),
    queryFn: async (): Promise<FleetConfigDetail> => (await fleet.getConfig(org, id)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const fleetConfigVersionQuery = (org: string, id: string, version: number) =>
  queryOptions({
    queryKey: fleetKeys.configVersion(org, id, version),
    queryFn: async (): Promise<FleetConfigVersion> =>
      (await fleet.getConfigVersion(org, id, version)).data,
    // A published version never changes.
    staleTime: Infinity,
  });

export const fleetAuditQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.audit(org),
    queryFn: async (): Promise<FleetAuditList> => {
      const list = (await fleet.listAudit(org)).data;
      if (!Array.isArray(list?.items)) throw new Error("Malformed fleet audit response");
      return list;
    },
    staleTime: LIVE_STALE_TIME,
  });

export const fleetSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.settings(org),
    queryFn: async (): Promise<FleetOrgSettings> => (await fleet.getSettings(org)).data,
    staleTime: LIVE_STALE_TIME,
  });

export const fleetRolloutsQuery = (org: string) =>
  queryOptions({
    queryKey: fleetKeys.rollouts(org),
    queryFn: async (): Promise<FleetRollout[]> => {
      const items = (await fleet.listRollouts(org)).data?.items;
      if (!Array.isArray(items)) throw new Error("Malformed fleet rollouts response");
      return items;
    },
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => rolloutPoll(query.state.data ?? []),
  });

export const fleetRolloutQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: fleetKeys.rollout(org, id),
    queryFn: async (): Promise<FleetRollout> => (await fleet.getRollout(org, id)).data,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => rolloutPoll(query.state.data ? [query.state.data] : []),
  });

export const fleetFlowQuery = (org: string, window: FleetFlowWindow) =>
  queryOptions({
    queryKey: fleetKeys.flow(org, window),
    queryFn: async (): Promise<FleetPipelines> => (await fleet.getPipelines(org, window)).data,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: FLOW_POLL_MS,
  });

// Every fleet write shows the server's own message, a 403 included, so each call site toasts its failure.
export const createFleetTokenMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: FleetCreateTokenRequest): Promise<FleetCreatedToken> =>
      (await fleet.createToken(org, body)).data,
    // The response carries the plaintext, so the cache must drop it as soon as nothing observes it.
    gcTime: 0,
    meta: { invalidates: [fleetKeys.tokens(org), fleetKeys.audit(org)], silentError: true },
  });

export const revokeFleetTokenMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (id: string): Promise<FleetToken> => (await fleet.revokeToken(org, id)).data,
    // Revoking closes every connection that used the token, so collectors, details and the summary change too.
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });

const collectorWrites = (org: string) => [
  fleetKeys.collectors(org),
  fleetKeys.summary(org),
  fleetKeys.fleets(org),
  fleetKeys.audit(org),
];

export const deleteCollectorsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (ids: string[]): Promise<BulkResult> =>
      settleAll(ids, (id) => fleet.deleteCollector(org, id)),
    // Removed even while a drawer still observes it, or reopening ?collector=<id> shows a ghost; meta.removes skips active entries.
    onSuccess: ({ succeeded }) => {
      for (const id of succeeded) {
        queryClient.removeQueries({ queryKey: fleetKeys.collector(org, id) });
      }
    },
    meta: { invalidates: collectorWrites(org), silentError: true },
  });

export const restartCollectorsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (ids: string[]): Promise<BulkResult> =>
      settleAll(ids, (id) => fleet.restartCollector(org, id)),
    meta: { invalidates: [fleetKeys.audit(org)], silentError: true },
  });

export const redeliverCollectorMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (id: string) => (await fleet.redeliverCollector(org, id)).data,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: fleetKeys.collector(org, id) });
    },
    meta: { invalidates: collectorWrites(org), silentError: true },
  });

export const renameCollectorMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { id: string; name: string }) =>
      (await fleet.renameCollector(org, vars.id, vars.name)).data,
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: fleetKeys.collector(org, vars.id) });
    },
    meta: { invalidates: [fleetKeys.collectors(org), fleetKeys.audit(org)], silentError: true },
  });

// A move assigns the destination's stable version at once, so every fleet read changes.
export const moveCollectorsMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { ids: string[]; to: string }) =>
      (await fleet.moveCollectors(org, vars.ids, vars.to)).data,
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });

export const createFleetMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (name: string): Promise<Fleet> => (await fleet.createFleet(org, name)).data,
    meta: { invalidates: [fleetKeys.fleets(org), fleetKeys.audit(org)], silentError: true },
  });

export const renameFleetMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { id: string; name: string }): Promise<Fleet> =>
      (await fleet.renameFleet(org, vars.id, vars.name)).data,
    // Collectors, tokens and rollouts carry the fleet's name.
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });

export const deleteFleetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => fleet.deleteFleet(org, id),
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });

export const updateFleetSettingsOfMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { id: string; body: FleetSettings }): Promise<FleetSettings> =>
      (await fleet.updateFleetSettings(org, vars.id, vars.body)).data,
    onSuccess: (data, vars) => {
      queryClient.setQueryData(fleetKeys.fleetSettings(org, vars.id), data);
    },
    meta: { invalidates: [fleetKeys.fleets(org), fleetKeys.audit(org)], silentError: true },
  });

export const createFleetConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: {
      id: string;
      description: string;
      yaml: string;
    }): Promise<FleetConfigDetail> => (await fleet.createConfig(org, body)).data,
    meta: { invalidates: [fleetKeys.configs(org), fleetKeys.audit(org)], silentError: true },
  });

export const saveFleetConfigDraftMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { id: string; yaml: string }) =>
      (await fleet.saveConfigDraft(org, vars.id, { yaml: vars.yaml })).data,
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: fleetKeys.config(org, vars.id) });
    },
    meta: { silentError: true },
  });

export const publishFleetConfigVersionMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: {
      id: string;
      yaml: string;
      message: string;
    }): Promise<FleetPublished> =>
      (await fleet.publishConfigVersion(org, vars.id, { yaml: vars.yaml, message: vars.message }))
        .data,
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: fleetKeys.config(org, vars.id) });
    },
    meta: { invalidates: [fleetKeys.configs(org), fleetKeys.audit(org)], silentError: true },
  });

export const deleteFleetConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => fleet.deleteConfig(org, id),
    // Removed even while observed, or a re-created id would show the deleted config's YAML.
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: fleetKeys.config(org, id) });
      queryClient.removeQueries({ queryKey: fleetKeys.configVersions(org, id) });
    },
    meta: { invalidates: [fleetKeys.configs(org), fleetKeys.audit(org)], silentError: true },
  });

export const validateFleetConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: { yaml: string }): Promise<{ issues: FleetConfigIssues }> =>
      (await fleet.validateConfig(org, body)).data,
    meta: { silentError: true },
  });

// A new desired version assigns collectors and moves the fleet's and the configs' state, so every fleet read is stale.
export const setFleetDesiredMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: {
      fleet: string;
      body: FleetSetDesiredRequest;
    }): Promise<FleetRollout> => (await fleet.setDesired(org, vars.fleet, vars.body)).data,
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });

export type RolloutExit = "resume" | "skip" | "rollback";

export const rolloutExitMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: {
      id: string;
      exit: RolloutExit;
      collectorIds?: string[];
    }): Promise<FleetRollout> => {
      if (vars.exit === "resume") return (await fleet.resumeRollout(org, vars.id)).data;
      if (vars.exit === "rollback") return (await fleet.rollbackRollout(org, vars.id)).data;
      return (await fleet.skipRollout(org, vars.id, vars.collectorIds ?? [])).data;
    },
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });

// A target change moves `outdated` in every collector read and adds an audit row, so every fleet read is stale.
export const updateFleetSettingsMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: FleetOrgSettings): Promise<FleetOrgSettings> =>
      (await fleet.updateSettings(org, body)).data,
    meta: { invalidates: [fleetKeys.all(org)], silentError: true },
  });
