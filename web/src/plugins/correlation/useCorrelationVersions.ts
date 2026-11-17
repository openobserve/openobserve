import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import streamService from "@/services/stream";
import { servicesQuery } from "@/services/service_versions.queries";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { isTraceBacked } from "@/types/serviceRef";
import { streamTraceRows } from "./correlationStream";
import {
  pickScope,
  podWhereColumns,
  podWheres,
  podWhereSql,
  podWindow,
  scopeByOwnPlace,
  summarizeVersions,
  versionColumns,
  versionsSql,
  type CorrelationPlace,
  type PodWhereRow,
  type VersionPodRow,
} from "./correlationVersions";

export interface CorrelationScopeInput {
  org: Ref<string>;
  user: Ref<string>;
  displayName: Ref<string | undefined>;
  displaySource: Ref<string | undefined>;
  place: Ref<CorrelationPlace>;
  enabled: Ref<boolean>;
  /** The trace stream and log time (microseconds) a pod read needs; without them the pod step is skipped. */
  traceStream?: Ref<string | undefined>;
  logTime?: Ref<number | undefined>;
}

export interface CorrelationVersionsInput extends CorrelationScopeInput {
  /** Off where the host already reads the scope for its own header. */
  scopeEnabled: Ref<boolean>;
  traceStream: Ref<string | undefined>;
  traceFilter: Ref<string>;
  startTime: Ref<number>;
  endTime: Ref<number>;
}

/** How a scope was picked from the log row's pod, for the where chip's tooltip. */
export interface ScopeByPod {
  pod: string;
  logCluster?: string;
}

/** The column names of a trace stream, shared by the versions read and the pod read. */
function useTraceFields(org: Ref<string>, stream: Ref<string | undefined>, enabled: Ref<boolean>) {
  const schema = useQuery(
    computed(() => ({
      queryKey: ["svcver-correlation-trace-fields", org.value, stream.value],
      queryFn: async () => {
        const response = await streamService.schema(org.value, stream.value || "", "traces");
        const fields = (response.data?.schema ?? []) as { name: string }[];
        return fields.map((field) => field.name);
      },
      enabled: enabled.value && !!stream.value && !!org.value,
      retry: false,
      staleTime: 300_000,
    })),
  );
  return computed<string[] | null | "pending">(() =>
    schema.isError.value ? null : (schema.data.value ?? "pending"),
  );
}

/** The scope (env, where, version, verdict) of a trace-backed display name, or null. */
export function useCorrelationScope(input: CorrelationScopeInput) {
  const service = computed(() =>
    isTraceBacked(input.displaySource.value) ? input.displayName.value || "" : "",
  );
  const tracesLock = useLicenseLock("traces");
  const services = useQuery(
    computed(() => ({
      ...servicesQuery(input.org.value, input.user.value, {
        signal: "traces",
        service: service.value,
      }),
      enabled:
        input.enabled.value && !!service.value && !!input.org.value && !tracesLock.locked.value,
      retry: false,
    })),
  );
  const scopes = computed(() =>
    services.data.value && !services.isError.value ? services.data.value.services : null,
  );
  const traceStream = computed(() => input.traceStream?.value);
  const logTime = computed(() => input.logTime?.value);
  // The pod is asked only when the row's own place cannot decide, so most rows make no extra read.
  const podWanted = computed(
    () =>
      !!scopes.value &&
      !!input.place.value.pod &&
      !!traceStream.value &&
      logTime.value !== undefined &&
      scopeByOwnPlace(scopes.value, service.value, input.place.value) === undefined,
  );
  const fields = useTraceFields(input.org, traceStream, podWanted);
  const columns = computed(() =>
    Array.isArray(fields.value) ? podWhereColumns(fields.value) : null,
  );
  const podRead = useQuery(
    computed(() => ({
      queryKey: [
        "svcver-correlation-pod-where",
        input.org.value,
        traceStream.value,
        service.value,
        input.place.value.pod,
        logTime.value,
        columns.value,
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const rows = await streamTraceRows<PodWhereRow>({
          org: input.org.value,
          sql: podWhereSql(
            traceStream.value || "",
            service.value,
            input.place.value.pod || "",
            columns.value ?? { pod: "", service: null },
          ),
          ...podWindow(logTime.value ?? 0),
          size: 2,
          signal,
        });
        return podWheres(rows);
      },
      enabled: podWanted.value && !!columns.value,
      retry: false,
      staleTime: 60_000,
    })),
  );
  // A stream with no pod or where column cannot answer, so the pod step falls through as if no pod were known.
  const podState = computed<string[] | null | undefined | "pending">(() => {
    if (!podWanted.value) return undefined;
    if (fields.value === null || podRead.isError.value) return null;
    if (fields.value === "pending") return "pending";
    if (!columns.value) return undefined;
    return podRead.data.value ?? "pending";
  });
  const scope = computed(() => {
    const state = podState.value;
    if (!scopes.value || state === "pending") return null;
    return pickScope(scopes.value, service.value, input.place.value, state);
  });
  const byPod = computed<ScopeByPod | null>(() => {
    const state = podState.value;
    if (!scope.value || !Array.isArray(state) || state.length !== 1) return null;
    return { pod: input.place.value.pod || "", logCluster: input.place.value.cluster };
  });
  return { scope, byPod };
}

/** The scope and the per-version pod counts of the correlated trace stream. */
export function useCorrelationVersions(input: CorrelationVersionsInput) {
  const { scope, byPod } = useCorrelationScope({
    ...input,
    enabled: computed(() => input.enabled.value && input.scopeEnabled.value),
  });
  const ready = computed(
    () => input.enabled.value && !!input.traceStream.value && !!input.org.value,
  );
  // Streams stamped before versions existed, or sent without Kubernetes attributes, lack a column the read needs.
  const fields = useTraceFields(input.org, input.traceStream, ready);
  const columns = computed(() =>
    Array.isArray(fields.value) ? versionColumns(fields.value) : null,
  );
  const versionRows = useQuery(
    computed(() => ({
      queryKey: [
        "svcver-correlation-versions",
        input.org.value,
        input.traceStream.value,
        input.traceFilter.value,
        input.startTime.value,
        input.endTime.value,
        columns.value?.pod ?? null,
      ],
      // A partial or failed read would undercount pods, so the stream helper rejects it and the line is hidden.
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        streamTraceRows<VersionPodRow>({
          org: input.org.value,
          sql: versionsSql(
            input.traceStream.value || "",
            input.traceFilter.value,
            columns.value ?? { pod: null },
          ),
          startTime: input.startTime.value,
          endTime: input.endTime.value,
          size: 5000,
          signal,
        }),
      enabled: ready.value && !!columns.value,
      retry: false,
      staleTime: 60_000,
    })),
  );
  const summary = computed(() =>
    versionRows.data.value && !versionRows.isError.value && columns.value
      ? summarizeVersions(versionRows.data.value, input.place.value.pod, !!columns.value.pod)
      : { versions: [], sourcePodVersion: null },
  );
  return { scope, byPod, summary };
}
