import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import streamService from "@/services/stream";
import { servicesQuery } from "@/services/service_versions.queries";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { isTraceBacked } from "@/types/serviceRef";
import { streamTraceRows } from "./correlationStream";
import {
  instancePinSql,
  instanceVersionFilter,
  instanceWhereSql,
  instanceWheres,
  instanceWindow,
  latestVersion,
  pickScope,
  scopeByOwnPlace,
  summarizeVersions,
  versionColumns,
  versionsSql,
  whereColumns,
  type CorrelationInstance,
  type CorrelationPlace,
  type VersionPodRow,
  type WhereRow,
} from "./correlationVersions";

export interface CorrelationScopeInput {
  org: Ref<string>;
  user: Ref<string>;
  displayName: Ref<string | undefined>;
  displaySource: Ref<string | undefined>;
  place: Ref<CorrelationPlace>;
  enabled: Ref<boolean>;
  /** The trace stream, its applied filters and the log time (microseconds) the instance reads need. */
  traceStream?: Ref<string | undefined>;
  traceFilter?: Ref<string>;
  logTime?: Ref<number | undefined>;
  /** The record's own instance; without one the header keeps the catalogue version. */
  instance?: Ref<CorrelationInstance | undefined>;
}

export interface CorrelationVersionsInput extends CorrelationScopeInput {
  /** Off where the host already reads the scope for its own header. */
  scopeEnabled: Ref<boolean>;
  traceStream: Ref<string | undefined>;
  traceFilter: Ref<string>;
  startTime: Ref<number>;
  endTime: Ref<number>;
}

/** The column names of a trace stream, shared by the versions read and the instance reads. */
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

/** The scope (env, where, version, verdict) of a trace-backed display name, and the version its log's instance runs. */
export function useCorrelationScope(input: CorrelationScopeInput) {
  const service = computed(() =>
    isTraceBacked(input.displaySource.value) ? input.displayName.value || "" : "",
  );
  const tracesLock = useLicenseLock("traces");
  const servicesEnabled = computed(
    () => input.enabled.value && !!service.value && !!input.org.value && !tracesLock.locked.value,
  );
  const services = useQuery(
    computed(() => ({
      ...servicesQuery(input.org.value, input.user.value, {
        signal: "traces",
        service: service.value,
      }),
      enabled: servicesEnabled.value,
      retry: false,
    })),
  );
  const scopes = computed(() =>
    services.data.value && !services.isError.value ? services.data.value.services : null,
  );
  const traceStream = computed(() => input.traceStream?.value);
  const logTime = computed(() => input.logTime?.value);
  const applied = computed(() => input.traceFilter?.value ?? "");
  // The record's spans are asked only when its own place cannot decide, so most rows make no extra read.
  const whereWanted = computed(
    () =>
      servicesEnabled.value &&
      !!scopes.value &&
      !!applied.value &&
      !!traceStream.value &&
      logTime.value !== undefined &&
      scopeByOwnPlace(scopes.value, service.value, input.place.value) === undefined,
  );
  const fields = useTraceFields(input.org, traceStream, whereWanted);
  const columns = computed(() =>
    Array.isArray(fields.value) ? whereColumns(fields.value, input.place.value.groups) : null,
  );
  const instance = computed(() => input.instance?.value);
  // The source instance names one place where service-only filters span several.
  const wherePin = computed(() =>
    Array.isArray(fields.value) && instance.value
      ? instancePinSql(fields.value, instance.value)
      : null,
  );
  const whereRead = useQuery(
    computed(() => ({
      queryKey: [
        "svcver-correlation-instance-where",
        input.org.value,
        traceStream.value,
        service.value,
        applied.value,
        wherePin.value,
        logTime.value,
        columns.value,
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const rows = await streamTraceRows<WhereRow>({
          org: input.org.value,
          sql: instanceWhereSql(
            traceStream.value || "",
            service.value,
            applied.value,
            columns.value ?? { service: [] },
            wherePin.value,
          ),
          ...instanceWindow(logTime.value ?? 0),
          size: 2,
          signal,
        });
        return instanceWheres(rows);
      },
      enabled: whereWanted.value && !!columns.value,
      retry: false,
      staleTime: 60_000,
    })),
  );
  // A stream with no where column cannot answer, so the step falls through as if the spans named nothing.
  const whereState = computed<string[] | null | undefined | "pending">(() => {
    if (!whereWanted.value) return undefined;
    if (fields.value === null || whereRead.isError.value) return null;
    if (fields.value === "pending") return "pending";
    if (!columns.value) return undefined;
    return whereRead.data.value ?? "pending";
  });
  const scope = computed(() => {
    const state = whereState.value;
    if (!scopes.value || state === "pending") return null;
    return pickScope(scopes.value, service.value, input.place.value, state);
  });
  const scopePending = computed(
    () => (servicesEnabled.value && services.isPending.value) || whereState.value === "pending",
  );
  const instanceKnown = computed(
    () => !!instance.value?.pinned || Object.keys(instance.value?.dimensions ?? {}).length > 0,
  );
  // Pinned to the resolved scope's place: a same-named instance elsewhere must not lend its version.
  const instanceWanted = computed(
    () =>
      servicesEnabled.value &&
      instanceKnown.value &&
      !!scope.value &&
      !!applied.value &&
      !!traceStream.value &&
      logTime.value !== undefined,
  );
  const instanceFields = useTraceFields(input.org, traceStream, instanceWanted);
  // Another instance of the service may run a newer version, so an unpinned read falls back to the catalogue.
  const instanceQuery = computed(() => {
    if (!Array.isArray(instanceFields.value) || !scope.value || !instance.value) return null;
    const pin = instancePinSql(instanceFields.value, instance.value);
    if (!pin && !instance.value.pinned) return null;
    return instanceVersionFilter(
      instanceFields.value,
      applied.value,
      scope.value,
      pin,
      instance.value.groups,
    );
  });
  const instanceRead = useQuery(
    computed(() => ({
      queryKey: [
        "svcver-correlation-instance-version",
        input.org.value,
        traceStream.value,
        logTime.value,
        instanceQuery.value,
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const filter = instanceQuery.value;
        if (!filter) return null;
        const rows = await streamTraceRows<VersionPodRow>({
          org: input.org.value,
          sql: versionsSql(traceStream.value || "", filter, { pod: null }),
          ...instanceWindow(logTime.value ?? 0),
          size: 50,
          signal,
        });
        return latestVersion(rows);
      },
      enabled: instanceWanted.value && !!instanceQuery.value,
      retry: false,
      staleTime: 60_000,
    })),
  );
  // Undefined while the read is still out, so the header never shows one version and then swaps it.
  const instanceVersion = computed<string | null | undefined>(() => {
    if (!instanceWanted.value) return scopePending.value ? undefined : null;
    if (instanceFields.value === null || instanceRead.isError.value) return null;
    if (instanceFields.value === "pending") return undefined;
    if (!instanceQuery.value) return null;
    return instanceRead.data.value === undefined ? undefined : instanceRead.data.value;
  });
  return { scope, instanceVersion };
}

/** The scope and the per-version pod counts of the correlated trace stream. */
export function useCorrelationVersions(input: CorrelationVersionsInput) {
  const { scope, instanceVersion } = useCorrelationScope({
    ...input,
    enabled: computed(() => input.enabled.value && input.scopeEnabled.value),
  });
  const ready = computed(
    () => input.enabled.value && !!input.traceStream.value && !!input.org.value,
  );
  // Streams stamped before versions existed, or sent without Kubernetes attributes, lack a column the read needs.
  const fields = useTraceFields(input.org, input.traceStream, ready);
  const columns = computed(() =>
    Array.isArray(fields.value) ? versionColumns(fields.value, input.instance?.value) : null,
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
      ? summarizeVersions(versionRows.data.value, !!columns.value.pod)
      : { versions: [] },
  );
  return { scope, instanceVersion, summary };
}
