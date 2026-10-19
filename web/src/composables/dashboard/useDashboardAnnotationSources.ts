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

import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
} from "vue";
import searchService from "@/services/search";
import type { AnnotationSource, QueryAnnotationMarker } from "@/ts/interfaces/dashboard";
import {
  ANNOTATION_SOURCE_ROW_LIMIT,
  annotationRowsToMarkers,
  annotationSourceTargetsPanel,
  getAnnotationSourceSql,
  type AnnotationRow,
  type AnnotationVariable,
} from "@/utils/dashboard/annotationSources";
import { getReferencedVariableNames } from "@/utils/dashboard/variables/variablesUtils";
import { usePanelVariableSubstitution } from "./usePanelVariableSubstitution";
import type { DashboardAnnotationSources } from "./usePanelAnnotationSources";

export {
  DASHBOARD_ANNOTATION_SOURCES_KEY,
  usePanelAnnotationSources,
} from "./usePanelAnnotationSources";
export type { DashboardAnnotationSources } from "./usePanelAnnotationSources";

/** A variable as the manager hands it over; only these keys are read here. */
export interface AnnotationQueryVariable extends AnnotationVariable {
  type?: string;
  isVariablePartialLoaded?: boolean;
  isLoading?: boolean;
  multiSelect?: boolean;
}

export interface AnnotationTimeRange {
  start_time?: Date;
  end_time?: Date;
}

/** The slice of the Vuex store a source query reads. */
export interface AnnotationQueryStore {
  state: {
    selectedOrganization: { identifier: string };
    organizationData?: { organizationSettings?: { scrape_interval?: number } };
  };
}

/** The slice of a dashboard the sources read. */
export interface AnnotationDashboardData {
  dashboardId?: string;
  annotationSources?: AnnotationSource[];
  variables?: { list?: Array<{ name?: string; scope?: string }> };
}

/** The dashboard's window and committed variables, for the settings form's Run preview. */
export interface AnnotationPreviewContext {
  timeRange: () => AnnotationTimeRange | undefined;
  variables: () => AnnotationQueryVariable[];
}

export interface AnnotationSourceQueryInput {
  source: AnnotationSource;
  /** Microseconds. */
  startTime: number;
  /** Microseconds. */
  endTime: number;
  variables: AnnotationQueryVariable[];
  store: AnnotationQueryStore;
  size: number;
  /** The builder stream's schema; fields it lacks are not selected. `null` means the fetch failed/is pending. */
  schemaFields?: string[] | null;
  signal?: AbortSignal;
  dashboardId?: string;
  folderId?: string;
}

export interface AnnotationSourceQueryResult {
  rows: AnnotationRow[];
  sql: string;
}

interface SourceRunState {
  markers: QueryAnnotationMarker[];
  error: string | null;
  /** The query returned exactly `ANNOTATION_SOURCE_ROW_LIMIT` rows, so more may exist beyond it. */
  truncated: boolean;
}

export const ANNOTATION_PREVIEW_CONTEXT_KEY: InjectionKey<AnnotationPreviewContext> = Symbol(
  "annotationPreviewContext",
);

const noop = () => undefined;

// A variable whose own lookup never settles (e.g. an erroring query-type variable) must not hang report capture forever.
const UNCOMMITTED_VARIABLE_WAIT_ATTEMPTS = 20;
const UNCOMMITTED_VARIABLE_WAIT_INTERVAL_MS = 250;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sourceTexts = (source: AnnotationSource) => [
  getAnnotationSourceSql(source),
  source.title,
  source.description,
];

const errorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { message?: string; error?: string } } })
    ?.response?.data;
  return response?.message || response?.error || (error as Error)?.message || String(error);
};

/** Runs one source over the window; `null` while a variable its query reads is still loading. */
export const runAnnotationSourceQuery = async (
  input: AnnotationSourceQueryInput,
): Promise<AnnotationSourceQueryResult | null> => {
  const rawSql = getAnnotationSourceSql(
    input.source,
    input.schemaFields === undefined ? [] : input.schemaFields,
    input.variables,
  );
  const substitution = usePanelVariableSubstitution({
    panelSchema: ref({ queries: [{ query: rawSql }] }),
    variablesData: ref({ values: input.variables }),
    chartPanelRef: ref(null),
    store: input.store,
    log: noop,
  });
  if (!substitution.ifPanelVariablesCompletedLoading()) return null;
  const { query: sql } = substitution.replaceQueryValue(
    rawSql,
    input.startTime,
    input.endTime,
    "sql",
  );
  const response = await searchService.search(
    {
      org_identifier: input.store.state.selectedOrganization.identifier,
      query: {
        query: {
          sql,
          start_time: input.startTime,
          end_time: input.endTime,
          from: 0,
          size: input.size,
        },
      },
      page_type: input.source.streamType || "logs",
      dashboard_id: input.dashboardId,
      folder_id: input.folderId,
      signal: input.signal,
    },
    "dashboards",
  );
  return { rows: response?.data?.hits ?? [], sql };
};

/** Runs each enabled source once per dashboard load, never per panel, and hands panels their markers. */
export const useDashboardAnnotationSources = (options: {
  dashboardData: () => AnnotationDashboardData | null | undefined;
  timeRange: () => AnnotationTimeRange | undefined;
  variables: () => AnnotationQueryVariable[];
  store: AnnotationQueryStore;
  folderId?: () => string | undefined;
  /** Field names of a stream; the store caches them, so repeat loads cost nothing. */
  schemaFields?: (_stream: string, _streamType: string) => Promise<string[]>;
}): DashboardAnnotationSources => {
  const results = shallowRef<Record<string, SourceRunState>>({});
  const loading = ref(false);
  let controller: AbortController | null = null;
  let generation = 0;

  const enabledSources: ComputedRef<AnnotationSource[]> = computed(() =>
    (options.dashboardData()?.annotationSources ?? []).filter(
      (source: AnnotationSource) => source && source.enabled !== false,
    ),
  );

  // Only global variables: sources run once for the whole dashboard, outside any tab or panel scope.
  const dashboardVariableNames = computed<string[]>(() =>
    (options.dashboardData()?.variables?.list ?? [])
      .filter((variable) => !variable?.scope || variable.scope === "global")
      .map((variable) => variable?.name ?? "")
      .filter((name) => name !== ""),
  );

  const referencedVariableNames = computed(
    () =>
      new Set(
        getReferencedVariableNames(
          enabledSources.value.flatMap(sourceTexts),
          dashboardVariableNames.value,
        ),
      ),
  );

  // Keyed on the variables the sources read, so an unrelated variable change re-runs nothing.
  const variablesKey = computed(() =>
    JSON.stringify(
      options
        .variables()
        .filter((variable) => referencedVariableNames.value.has(variable.name))
        .map((variable) => [
          variable.name,
          variable.value,
          variable.isVariablePartialLoaded,
          variable.isLoading,
        ]),
    ),
  );

  const sourcesKey = computed(() => JSON.stringify(enabledSources.value));

  // A referenced variable the manager has not committed yet would reach the query as a literal `$name`.
  const hasUncommittedVariable = (
    source: AnnotationSource,
    variables: AnnotationQueryVariable[],
  ) => {
    const present = new Set(variables.map((variable) => variable.name));
    const used = getReferencedVariableNames(sourceTexts(source), dashboardVariableNames.value);
    return [...used].some((name) => !present.has(name));
  };

  const attemptSource = async (
    source: AnnotationSource,
    window: { start: number; end: number },
    variables: AnnotationQueryVariable[],
    signal: AbortSignal,
  ): Promise<SourceRunState | null> => {
    if (hasUncommittedVariable(source, variables)) return null;
    try {
      // `null` (fetch failed) excludes every field; `[]` (a genuinely empty schema) includes them all.
      const schemaFields =
        source.mode === "builder" && options.schemaFields && !source.stream.includes("$")
          ? await options.schemaFields(source.stream, source.streamType || "logs").catch(() => null)
          : [];
      const result = await runAnnotationSourceQuery({
        schemaFields,
        source,
        startTime: window.start,
        endTime: window.end,
        variables,
        store: options.store,
        size: ANNOTATION_SOURCE_ROW_LIMIT,
        signal,
        dashboardId: options.dashboardData()?.dashboardId,
        folderId: options.folderId?.(),
      });
      if (result === null) return null;
      return {
        markers: annotationRowsToMarkers(source, result.rows, variables),
        error: null,
        truncated: result.rows.length === ANNOTATION_SOURCE_ROW_LIMIT,
      };
    } catch (error) {
      return { markers: [], error: errorMessage(error), truncated: false };
    }
  };

  // Retries a source stuck on an uncommitted variable for a bounded time, then reports it failed instead of hanging `loading` forever.
  const runSource = async (
    source: AnnotationSource,
    window: { start: number; end: number },
    variables: AnnotationQueryVariable[],
    signal: AbortSignal,
  ): Promise<SourceRunState> => {
    for (let attempt = 0; attempt < UNCOMMITTED_VARIABLE_WAIT_ATTEMPTS; attempt++) {
      const state = await attemptSource(source, window, variables, signal);
      if (state !== null) return state;
      if (signal.aborted) break;
      await wait(UNCOMMITTED_VARIABLE_WAIT_INTERVAL_MS);
      variables = options.variables() ?? [];
    }
    return {
      markers: [],
      error: "A variable this source's query references never committed.",
      truncated: false,
    };
  };

  const run = async () => {
    controller?.abort();
    controller = null;
    const runGeneration = ++generation;
    const sources = enabledSources.value;
    const range = options.timeRange();
    const start = range?.start_time?.getTime?.();
    const end = range?.end_time?.getTime?.();
    if (!sources.length || !Number.isFinite(start) || !Number.isFinite(end)) {
      results.value = {};
      loading.value = false;
      return;
    }
    const currentController = new AbortController();
    controller = currentController;
    loading.value = true;
    const variables = options.variables() ?? [];
    const window = { start: start as number, end: end as number };
    const states = await Promise.all(
      sources.map((source) => runSource(source, window, variables, currentController.signal)),
    );
    if (runGeneration !== generation) return;
    const next: Record<string, SourceRunState> = {};
    sources.forEach((source, index) => {
      next[source.id] = states[index];
    });
    results.value = next;
    loading.value = false;
  };

  watch([sourcesKey, () => options.timeRange(), variablesKey], run, { immediate: true });

  onBeforeUnmount(() => {
    generation++;
    controller?.abort();
  });

  const targetingSources = (panelId: string, panelType: string) =>
    enabledSources.value.filter((source) =>
      annotationSourceTargetsPanel(source, panelId, panelType),
    );

  return {
    loading,
    markersForPanel: (panelId, panelType) =>
      targetingSources(panelId, panelType).flatMap(
        (source) => results.value[source.id]?.markers ?? [],
      ),
    failedSourcesForPanel: (panelId, panelType) =>
      targetingSources(panelId, panelType)
        .filter((source) => results.value[source.id]?.error)
        .map((source) => source.name),
    truncatedSourcesForPanel: (panelId, panelType) =>
      targetingSources(panelId, panelType)
        .filter((source) => results.value[source.id]?.truncated)
        .map((source) => source.name),
  };
};
