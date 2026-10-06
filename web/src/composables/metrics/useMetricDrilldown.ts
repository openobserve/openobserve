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

import { computed, ref } from "vue";
import config from "@/aws-exports";
import serviceStreamsApi, {
  type FieldAlias,
  type ServiceIdentityConfig,
  type StreamInfo,
} from "@/services/service_streams";
import metricsService from "@/services/metrics";
import {
  availability as availabilityOf,
  buildLogsRoute,
  buildTracesRoute,
  contextToDimensions,
  droppedLabelNames,
  serviceLabelFor,
  type ReadStatus,
} from "@/utils/metrics/metricDrilldown";

const SERVICE_VALUE_CAP = 20;

export type DrilldownSignal = "logs" | "traces";

export interface DrilldownStream {
  name: string;
  /** A stream with no identity filters would open every record, so it is listed but not opened. */
  openable: boolean;
  info: StreamInfo;
}

export type DrilldownNotice = "noServiceLabel" | "needIdentity" | "noService" | "noPermission";

export type DrilldownMenu =
  | { kind: "idle" }
  | { kind: "loading" }
  /** `message` null: the metric's schema could not be loaded. */
  | { kind: "error"; message: string | null }
  | { kind: "notice"; notice: DrilldownNotice }
  | { kind: "pickService"; label: string; values: string[] }
  | {
      kind: "streams";
      service: string;
      logs: DrilldownStream[];
      traces: DrilldownStream[];
    };

interface LabelFilterLike {
  label: string;
  value: string;
  operator?: string;
}

export interface UseMetricDrilldownDeps {
  org: () => string;
  metric: () => { name: string; labels?: string[] } | null;
  /** Labels from the grid's schema load, for a card that came without them. */
  labelsOf: (name: string) => string[] | undefined;
  ensureSchemas: () => Promise<void>;
  filters: () => LabelFilterLike[];
  inapplicableFilters: () => LabelFilterLike[];
  timeRange: () => { start_time: number; end_time: number };
  serviceStreamsEnabled: () => boolean;
  router: { push: (route: any) => unknown };
  store: { dispatch: (type: string, payload?: unknown) => unknown };
  /** Told the user's names of the identity labels a stream could not apply. */
  onDropped: (labels: string[]) => void;
}

const statusOf = (error: any): number => Number(error?.response?.status) || 0;
const messageOf = (error: any): string =>
  error?.response?.data?.message ?? error?.message ?? String(error);

export function useMetricDrilldown(deps: UseMetricDrilldownDeps) {
  const identityStatus = ref<ReadStatus>("pending");
  const groupsStatus = ref<ReadStatus>("pending");
  const readError = ref<string | null>(null);
  let identityConfig: ServiceIdentityConfig = { sets: [], tracked_alias_ids: [] };
  let semanticGroups: FieldAlias[] = [];

  const availability = computed(() =>
    availabilityOf({
      isEnterprise: config.isEnterprise,
      serviceStreamsEnabled: deps.serviceStreamsEnabled(),
      identityStatus: identityStatus.value,
      groupsStatus: groupsStatus.value,
    }),
  );

  const menu = ref<DrilldownMenu>({ kind: "idle" });
  let pickedService: LabelFilterLike | null = null;
  let labelByGroupId: Record<string, string> = {};
  let generation = 0;
  let lastStep: () => Promise<void> = async () => {};

  // Each read keeps its status: the shared loaders turn a 403 into an empty answer.
  const loadReads = async () => {
    readError.value = null;
    const org = deps.org();
    const [identity, groups] = await Promise.allSettled([
      serviceStreamsApi.getIdentityConfig(org),
      serviceStreamsApi.getSemanticGroups(org),
    ]);
    if (identity.status === "fulfilled") {
      identityConfig = identity.value.data ?? identityConfig;
      identityStatus.value = "ok";
    } else {
      identityStatus.value = statusOf(identity.reason);
      readError.value = messageOf(identity.reason);
    }
    if (groups.status === "fulfilled") {
      semanticGroups = groups.value.data ?? [];
      groupsStatus.value = "ok";
    } else {
      groupsStatus.value = statusOf(groups.reason);
      readError.value ??= messageOf(groups.reason);
    }
  };

  const readsReady =
    config.isEnterprise === "true" && deps.serviceStreamsEnabled()
      ? loadReads()
      : Promise.resolve();

  const correlate = async (mine: number) => {
    const metric = deps.metric();
    if (!metric) return;
    const context = contextToDimensions(
      pickedService ? [...deps.filters(), pickedService] : deps.filters(),
      deps.inapplicableFilters(),
      semanticGroups,
      identityConfig,
    );
    labelByGroupId = context.labelByGroupId;
    menu.value = { kind: "loading" };
    lastStep = () => correlate(++generation);
    try {
      const response = await serviceStreamsApi.correlate(deps.org(), {
        source_stream: metric.name,
        source_type: "metrics",
        available_dimensions: context.dimensions,
      });
      if (mine !== generation) return;
      const data = response?.data;
      if (!data) {
        menu.value = { kind: "notice", notice: "noService" };
        return;
      }
      const listed = (streams: StreamInfo[] = []): DrilldownStream[] =>
        streams.map((info) => ({
          name: info.stream_name,
          openable: !!info.filters && Object.keys(info.filters).length > 0,
          info,
        }));
      menu.value = {
        kind: "streams",
        service: data.service_name,
        logs: listed(data.related_streams?.logs),
        traces: listed(data.related_streams?.traces),
      };
    } catch (error: any) {
      if (mine !== generation) return;
      menu.value =
        statusOf(error) === 403
          ? { kind: "notice", notice: "noPermission" }
          : { kind: "error", message: messageOf(error) };
    }
  };

  const offerServices = async (mine: number, label: string) => {
    const metric = deps.metric();
    if (!metric) return;
    const { start_time, end_time } = deps.timeRange();
    try {
      const response: any = await metricsService.labelValues({
        org_identifier: deps.org(),
        label,
        match: metric.name,
        start_time,
        end_time,
      });
      if (mine !== generation) return;
      const values: string[] = [...(response?.data?.data ?? [])].sort().slice(0, SERVICE_VALUE_CAP);
      menu.value = { kind: "pickService", label, values };
    } catch (error: any) {
      if (mine !== generation) return;
      menu.value = { kind: "error", message: messageOf(error) };
    }
  };

  /** What the menu shows on opening: the context decides between a service pick, a notice and the streams. */
  const open = async () => {
    if (availability.value !== "available") return;
    const mine = ++generation;
    pickedService = null;
    lastStep = open;
    menu.value = { kind: "loading" };
    await readsReady;
    if (mine !== generation) return;
    if (readError.value) {
      menu.value = { kind: "error", message: readError.value };
      return;
    }

    const metric = deps.metric();
    if (!metric) return;
    try {
      await deps.ensureSchemas();
    } catch {
      // The labels check below reports it.
    }
    if (mine !== generation) return;
    const labels = metric.labels ?? deps.labelsOf(metric.name);
    if (!labels) {
      menu.value = { kind: "error", message: null };
      return;
    }

    const { dimensions } = contextToDimensions(
      deps.filters(),
      deps.inapplicableFilters(),
      semanticGroups,
      identityConfig,
    );
    if (identityConfig.service_optional) {
      if (!Object.keys(dimensions).length) {
        menu.value = { kind: "notice", notice: "needIdentity" };
        return;
      }
    } else if (!dimensions.service) {
      const label = serviceLabelFor(labels, semanticGroups);
      if (!label) {
        menu.value = { kind: "notice", notice: "noServiceLabel" };
        return;
      }
      await offerServices(mine, label);
      return;
    }
    await correlate(mine);
  };

  /** The pick joins this drilldown's context only; the page's filters are untouched. */
  const pickService = async (value: string) => {
    if (menu.value.kind !== "pickService") return;
    pickedService = { label: menu.value.label, value };
    await correlate(++generation);
  };

  const retry = async () => {
    if (readError.value) {
      await loadReads();
      await open();
      return;
    }
    await lastStep();
  };

  const openStream = (signal: DrilldownSignal, stream: DrilldownStream) => {
    if (!stream.openable) return;
    const args = {
      stream: stream.name,
      filters: stream.info.filters ?? {},
      timeRange: deps.timeRange(),
      org: deps.org(),
    };
    const dropped = stream.info.dropped_dimensions ?? [];
    if (dropped.length) deps.onDropped(droppedLabelNames(dropped, labelByGroupId));
    if (signal === "logs") {
      deps.store.dispatch("logs/setIsInitialized", false);
      deps.router.push(buildLogsRoute(args));
    } else {
      deps.router.push(buildTracesRoute(args));
    }
  };

  return { availability, menu, open, pickService, retry, openStream };
}
