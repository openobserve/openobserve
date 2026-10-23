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

import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { useStore } from "vuex";
import {
  valueMappingPatternError,
  type ValueMappingPatternError,
} from "@/utils/dashboard/tableConfigUtils";

/** How the dialog matches a series: an exact legend name or a pattern. */
export type SeriesDraftMatch = "name" | "regex";

/** Thresholds as an override stores them; same shape as `config.thresholds`. */
export interface SeriesOverrideThresholds {
  mode?: "absolute" | "percentage";
  showAs?: "color_line" | "color" | "line" | "color_band";
  baseColor?: string | null;
  steps?: { value: number; color: string }[];
}

/** A chart entry of `config.override_config`; table entries use matchBy "name". */
export interface SeriesOverrideEntry {
  field: { matchBy: "series" | "series_regex"; value: string };
  config: { type: string; value: unknown }[];
}

/** One override while the Series Formatting dialog edits it; "" and null mean inherit. */
export interface SeriesOverrideDraft {
  id: number;
  matchBy: SeriesDraftMatch;
  value: string;
  displayName: string;
  unit: string | null;
  unitCustom: string;
  decimals: string;
  color: string | null;
  thresholds: SeriesOverrideThresholds | undefined;
}

/** The applied panel schema plus the data the editor already fetched for it. */
export interface SeriesOverridePreviewSource {
  panelSchema: any;
  data: any;
  metadata?: any;
  resultMetaData?: any;
  /** Query indexes the editor hides from the panel. */
  hiddenQueries?: number[];
}

const PREVIEW_DEBOUNCE_MS = 120;
const STORED_MATCH = { name: "series", regex: "series_regex" } as const;

let nextDraftId = 0;

const cloneThresholds = (thresholds: unknown): SeriesOverrideThresholds | undefined => {
  const steps = (thresholds as SeriesOverrideThresholds | undefined)?.steps;
  return Array.isArray(steps) && steps.length > 0
    ? JSON.parse(JSON.stringify(thresholds))
    : undefined;
};

/** True for the chart entries of `override_config`; every other entry belongs to tables. */
export const isSeriesOverrideEntry = (entry: any): entry is SeriesOverrideEntry =>
  entry?.field?.matchBy === "series" || entry?.field?.matchBy === "series_regex";

/** The chart entries of a panel's `override_config`, in order. */
export const getSeriesOverrideEntries = (overrideConfig: unknown): SeriesOverrideEntry[] =>
  Array.isArray(overrideConfig) ? overrideConfig.filter(isSeriesOverrideEntry) : [];

/** Replaces the chart entries and keeps every table entry in its order; chart entries follow, in override order. */
export const withSeriesOverrideEntries = (
  overrideConfig: unknown,
  entries: SeriesOverrideEntry[],
): any[] => [
  ...(Array.isArray(overrideConfig) ? overrideConfig : []).filter(
    (entry) => !isSeriesOverrideEntry(entry),
  ),
  ...entries,
];

export const emptySeriesOverrideDraft = (
  matchBy: SeriesDraftMatch,
  value = "",
): SeriesOverrideDraft => ({
  id: ++nextDraftId,
  matchBy,
  value,
  displayName: "",
  unit: null,
  unitCustom: "",
  decimals: "",
  color: null,
  thresholds: undefined,
});

/** A stored series entry as an editable draft (a copy, so Cancel discards edits). */
export const toSeriesOverrideDraft = (stored: any): SeriesOverrideDraft => {
  const draft = emptySeriesOverrideDraft(
    stored?.field?.matchBy === "series_regex" ? "regex" : "name",
    typeof stored?.field?.value === "string" ? stored.field.value : "",
  );
  for (const item of Array.isArray(stored?.config) ? stored.config : []) {
    const value = item?.value;
    if (item?.type === "unit") {
      draft.unit = typeof value?.unit === "string" && value.unit !== "" ? value.unit : null;
      draft.unitCustom = typeof value?.customUnit === "string" ? value.customUnit : "";
    } else if (item?.type === "decimals") {
      draft.decimals = value === null || value === undefined ? "" : String(value);
    } else if (item?.type === "display_name") {
      draft.displayName = typeof value === "string" ? value : "";
    } else if (item?.type === "series_color") {
      draft.color = typeof value === "string" && value !== "" ? value : null;
    } else if (item?.type === "thresholds") {
      draft.thresholds = cloneThresholds(value);
    }
  }
  return draft;
};

/** A whole number of decimals, or null when the field is empty or not a number >= 0. */
export const parseDecimals = (text: string | number | null | undefined): number | null => {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
};

/** Why a regex override can never match, or null when it compiles (name overrides never fail). */
export const seriesPatternError = (draft: SeriesOverrideDraft): ValueMappingPatternError | null =>
  draft.matchBy === "regex" && draft.value !== "" ? valueMappingPatternError(draft.value) : null;

/** The stored entry for a draft with only the settings that are set; null when it matches or sets nothing. */
export const serializeSeriesOverride = (draft: SeriesOverrideDraft): SeriesOverrideEntry | null => {
  if (draft.value.trim() === "") return null;
  const config: SeriesOverrideEntry["config"] = [];
  if (draft.unit) {
    const customUnit = draft.unit === "custom" ? draft.unitCustom.trim() : "";
    config.push({ type: "unit", value: { unit: draft.unit, customUnit } });
  }
  const decimals = parseDecimals(draft.decimals);
  if (decimals !== null) config.push({ type: "decimals", value: decimals });
  const displayName = draft.displayName.trim();
  if (displayName) config.push({ type: "display_name", value: displayName });
  if (draft.color) config.push({ type: "series_color", value: draft.color });
  const thresholds = cloneThresholds(draft.thresholds);
  if (thresholds) config.push({ type: "thresholds", value: thresholds });
  if (!config.length) return null;
  return { field: { matchBy: STORED_MATCH[draft.matchBy], value: draft.value }, config };
};

export const serializeSeriesOverrides = (drafts: SeriesOverrideDraft[]): SeriesOverrideEntry[] =>
  drafts
    .map((draft) => serializeSeriesOverride(draft))
    .filter((entry): entry is SeriesOverrideEntry => entry !== null);

/** Legend series names of converted chart options, read per chart type like Color by series. */
export const getLegendSeriesNames = (options: any, chartType: string): string[] => {
  const series: any[] = Array.isArray(options?.series) ? options.series : [];
  let names: unknown[];
  if (chartType === "pie" || chartType === "donut") {
    names = (series[0]?.data ?? []).map((item: any) => item?.name);
  } else if (chartType === "gauge") {
    names = series.map((s: any) => s?.data?.[0]?.name);
  } else if (chartType === "metric") {
    // `_metricLabel` is drawn and may hold a display name; overrides match `_metricName`.
    names = series.map((s: any) => s?._metricName ?? s?._metricLabel);
  } else {
    names = series.map((s: any) => s?.name);
  }
  const unique = new Set<string>();
  for (const name of names) {
    if (typeof name === "string" && name !== "") unique.add(name);
  }
  // A plain PromQL bar is one unnamed series whose categories are the series names.
  if (!unique.size && (chartType === "bar" || chartType === "h-bar")) {
    const axes = [options?.yAxis, options?.xAxis].flat();
    const categories = axes.find((axis: any) => axis?.type === "category")?.data ?? [];
    for (const name of categories) {
      if (typeof name === "string" && name !== "") unique.add(name);
    }
  }
  return [...unique];
};

/** Names of a PromQL metric panel's values, built the way the converter names them (its options carry no label). */
export const getPromqlMetricSeriesNames = async (
  source: SeriesOverridePreviewSource,
  store: any,
): Promise<string[]> => {
  const [{ alignShiftedPromQLResults }, { buildPromqlSeriesNames }, { legendFallbackOf }, cache] =
    await Promise.all([
      import("@/utils/dashboard/convertPromQLData"),
      import("@/utils/dashboard/promql/shared/legendBuilder"),
      import("@/utils/dashboard/promql/formula"),
      import("@/utils/semanticGroupsCache"),
    ]);
  const { data, parentQueryIndex, nameSuffixes } = alignShiftedPromQLResults(
    source.data,
    source.metadata,
    source.resultMetaData,
  );
  const queries = source.panelSchema?.queries;
  // Same per-query series cap as the converter, since the cap decides which labels tell series apart.
  const maxSeries = store?.state?.zoConfig?.max_dashboard_series ?? 100;
  const primaries = data.filter((q: any, i: number) => !nameSuffixes[i] && q?.result?.length > 0);
  const limit = primaries.length > 1 ? Math.floor(maxSeries / primaries.length) : maxSeries;
  const limited = data.map((q: any, i: number) =>
    nameSuffixes[i] || !q?.result ? q : { ...q, result: q.result.slice(0, limit) },
  );
  const names = buildPromqlSeriesNames(
    limited.map((q: any, i: number) => ({
      metrics: (q?.result ?? []).map((m: any) => m?.metric).filter(Boolean),
      template: queries?.[parentQueryIndex[i]]?.config?.promql_legend,
      fallback: legendFallbackOf(queries, parentQueryIndex[i]),
    })),
    cache.getCachedSemanticGroups(store?.state?.selectedOrganization?.identifier ?? "") ?? [],
  );
  const unique = new Set<string>();
  limited.forEach((q: any, i: number) => {
    const metric = q?.result?.[0];
    if (!metric) return;
    const name = names.get(metric.metric) ?? "";
    const full = nameSuffixes[i] ? `${name} (${nameSuffixes[i]})` : name;
    if (full) unique.add(full);
  });
  return [...unique];
};

/** The source as PanelSchemaRenderer converts it: hidden queries dropped from data, schema and metadata alike. */
export const withoutHiddenQueries = (
  source: SeriesOverridePreviewSource,
): SeriesOverridePreviewSource => {
  const hidden = source.hiddenQueries ?? [];
  if (!hidden.length || !Array.isArray(source.data)) return source;
  const isPromql = source.panelSchema?.queryType === "promql";
  // Shifted PromQL results follow their primaries, so an array index is not a query index there.
  const isHiddenAt = (index: number) =>
    hidden.includes(
      isPromql ? (source.metadata?.queries?.[index]?.panelQueryIndex ?? index) : index,
    );
  const data = source.data.filter((_: unknown, index: number) => !isHiddenAt(index));
  if (!isPromql) {
    const queries = source.panelSchema?.queries;
    if (!Array.isArray(queries)) return { ...source, data };
    return {
      ...source,
      data,
      panelSchema: {
        ...source.panelSchema,
        queries: queries.filter((_: unknown, index: number) => !hidden.includes(index)),
      },
    };
  }
  const metaQueries = source.metadata?.queries;
  return {
    ...source,
    data,
    metadata: Array.isArray(metaQueries)
      ? {
          ...source.metadata,
          queries: metaQueries.filter((_: unknown, index: number) => !isHiddenAt(index)),
        }
      : source.metadata,
    resultMetaData: Array.isArray(source.resultMetaData)
      ? source.resultMetaData.filter((_: unknown, index: number) => !isHiddenAt(index))
      : source.resultMetaData,
  };
};

const hasPreviewData = (source: SeriesOverridePreviewSource | null | undefined) =>
  !!source?.panelSchema && Array.isArray(source.data) && source.data.length > 0;

const convertWithOverrides = async (
  source: SeriesOverridePreviewSource,
  overrides: SeriesOverrideEntry[],
  store: any,
  chartPanelRef: { value: HTMLElement | null },
) => {
  const { convertPanelData } = await import("@/utils/dashboard/convertPanelData");
  // A copy, so neither the converters nor the draft can touch the schema the editor renders.
  const schema = JSON.parse(JSON.stringify(source.panelSchema));
  schema.config = schema.config ?? {};
  const merged = withSeriesOverrideEntries(schema.config.override_config, overrides);
  if (merged.length > 0) schema.config.override_config = merged;
  else delete schema.config.override_config;
  return convertPanelData(
    schema,
    source.data,
    store,
    chartPanelRef,
    null,
    { value: source.resultMetaData ?? [] },
    source.metadata ?? {},
    { height: "100%", width: "100%" },
    { value: [] },
    false,
  );
};

const readOriginalNames = async (
  source: SeriesOverridePreviewSource,
  chartType: string,
  store: any,
): Promise<string[]> => {
  if (chartType === "metric" && source.panelSchema?.queryType === "promql") {
    return getPromqlMetricSeriesNames(source, store);
  }
  const detached = { value: document.createElement("div") };
  const result = await convertWithOverrides(source, [], store, detached);
  return getLegendSeriesNames(result?.options, chartType);
};

/** Converts the editor's fetched data twice: without overrides for the original legend names, and with the draft for the preview. */
export const useSeriesOverridePreview = (options: {
  active: Ref<boolean>;
  source: Ref<SeriesOverridePreviewSource | null | undefined>;
  chartType: Ref<string>;
  overrides: Ref<SeriesOverrideEntry[]>;
  chartPanelRef: Ref<HTMLElement | null>;
}) => {
  const store = useStore();
  const baseNames = ref<string[] | null>(null);
  const previewData = shallowRef<any>(null);
  let baseGeneration = 0;
  let previewGeneration = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const visibleSource = computed(() =>
    options.source.value ? withoutHiddenQueries(options.source.value) : null,
  );

  watch(
    [options.active, visibleSource],
    async ([active, source]) => {
      const generation = ++baseGeneration;
      if (!active || !hasPreviewData(source)) {
        baseNames.value = null;
        return;
      }
      try {
        const names = await readOriginalNames(source!, options.chartType.value, store);
        if (generation !== baseGeneration) return;
        baseNames.value = names;
      } catch {
        if (generation === baseGeneration) baseNames.value = null;
      }
    },
    { immediate: true },
  );

  const renderPreview = async () => {
    const generation = ++previewGeneration;
    const source = visibleSource.value;
    const element = options.chartPanelRef.value;
    if (!options.active.value || !hasPreviewData(source) || !element) {
      previewData.value = null;
      return;
    }
    try {
      const result = await convertWithOverrides(source!, options.overrides.value, store, {
        value: element,
      });
      if (generation === previewGeneration) previewData.value = result?.options ? result : null;
    } catch {
      if (generation === previewGeneration) previewData.value = null;
    }
  };

  watch(
    [
      options.active,
      visibleSource,
      options.chartPanelRef,
      () => JSON.stringify(options.overrides.value),
    ],
    () => {
      if (timer) clearTimeout(timer);
      if (!options.active.value) {
        previewGeneration++;
        previewData.value = null;
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        renderPreview();
      }, PREVIEW_DEBOUNCE_MS);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    baseGeneration++;
    previewGeneration++;
  });

  return { baseNames, previewData };
};
