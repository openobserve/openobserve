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

import { gt } from "@/types/i18n";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { format as echartsFormat } from "echarts/core";
import { CHART_SELECTION_FILL, chartColor, dataZoomBrushStyle } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { addCommasToNumber, durationFormatter } from "@/utils/formatters";
import { getCachedSemanticGroups } from "@/utils/semanticGroupsCache";
import { getDataValue } from "./aliasUtils";
import { getContrastColor } from "./chartColorUtils";
import { getColorPalette, getGridLineStyle, getSeriesHash } from "./colorPalette";
import { formatDate } from "./dateTimeUtils";
import { buildPromqlSeriesNames } from "./promql/shared/legendBuilder";
import { legendFallbackOf } from "./promql/formula";
import { buildValueMappingCache, lookupValueMappingFull } from "./tableConfigUtils";
import { normalizeThresholds, resolveStepValues, stepColorFor } from "./thresholds";
import { getAnnotationsData } from "./getAnnotationsData";
import { getAllSpanColors } from "@/utils/traces/traceColors";
import { resolveSeriesOverride } from "./seriesOverrides";

export const STATE_TIMELINE_MAX_ROWS = 500;
export const STATE_TIMELINE_MAX_STATES = 20;
/** Fallback for the server's max_dashboard_state_timeline_series; restarts split one entity into several series. */
export const STATE_TIMELINE_MAX_SERIES = 2000;
export const STATE_TIMELINE_TOOLTIP_MAX_ROWS = 20;
/** Ids of the row-scroll dataZooms; their events scroll rows and never zoom time. */
export const STATE_TIMELINE_ROW_ZOOM_IDS = [
  "state-timeline-row-scroll",
  "state-timeline-row-wheel",
];
const DEFAULT_ROW_HEIGHT = 24;
const DEFAULT_ROW_GAP = 4;
const FALLBACK_STEP_MS = 60_000;
const AUTO_MERGE_GAP_FACTOR = 0.5;
const GRID_TOP = 8;
const ANNOTATION_LABEL_ROOM = 18;
// Above the segment rectangles (custom series z 2) so a range tints the states instead of hiding under them.
const ANNOTATION_Z = 10;
const X_AXIS_ROOM = 28;
const LEGEND_ROOM = 28;
const SCROLLBAR_ROOM = 24;
const MIN_TEXT_WIDTH = 24;
const TEXT_PADDING = 4;
const CONTRAST_THRESHOLD = 0.5;
const NO_DATA_STYLE = -1;

export type StateTimelineSort = "name" | "non_ok_time";

/** The rows in view: `anchor` is the first visible row's name, `start` and `end` its indexes. */
export interface RowWindow {
  anchor: string;
  start: number;
  end: number;
}

export interface StateSample {
  t: number;
  state: string | null;
}

/** A run of one state; `state` null is a "no data" stretch. Times are epoch ms. */
export interface StateSegment {
  start: number;
  end: number;
  state: string | null;
}

interface ExtractedRow {
  name: string;
  /** The entity behind a name that was made unique. */
  entity?: string;
  labels: Record<string, string>;
  samples: StateSample[];
  /** Index of the source query in the converter's data. */
  query: number;
  label: string;
  /** The source query's response metadata, which carries its step. */
  meta?: any;
}

interface StateRow {
  name: string;
  /** The label shown on the axis; a row override's display name, else the name. */
  displayName?: string;
  /** Which mappings and thresholds colour the row: "" for the panel's, else a row override's. */
  scope?: string;
  /** The breakdown value behind a name that was made unique across queries. */
  entity?: string;
  labels: Record<string, string>;
  samples: StateSample[];
  segments: StateSegment[];
}

export interface StateStyle {
  text: string;
  color: string;
  textColor: string;
}

interface StyleScope {
  mappings?: any[];
  thresholds?: unknown;
}

interface StateGroup {
  text: string;
  duration: number;
  states: string[];
  mappedColor: string | null;
  thresholdColor: string | null;
  textColor: string | null;
}

const toState = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

// PromQL encodes a missing reading as NaN; neither it nor an infinity is a state.
const toPromqlState = (value: unknown): string | null =>
  ["NaN", "Inf", "+Inf", "-Inf"].includes(String(value)) ? null : toState(value);

const toEpochMs = (value: unknown): number => {
  if (typeof value === "number") {
    if (value > 1e14) return value / 1000;
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value !== "string" || value === "") return NaN;
  if (/^\d+$/.test(value)) return toEpochMs(Number(value));
  // Histogram buckets come back as UTC strings without a zone suffix.
  return Date.parse(/(z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value}Z`);
};

/** Splits samples into merged segments; an empty stretch after a sample's step longer than `mergeGapMs` becomes "no data". */
export const buildStateSegments = (
  samples: StateSample[],
  stepMs: number,
  mergeGapMs: number,
  range: { start?: number; end?: number } = {},
): StateSegment[] => {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const segments: StateSegment[] = [];
  const push = (start: number, end: number, state: string | null) => {
    if (end <= start) return;
    const last = segments[segments.length - 1];
    if (last && last.end === start && last.state === state) {
      last.end = end;
      return;
    }
    segments.push({ start, end, state });
  };

  if (sorted.length && range.start !== undefined && sorted[0].t - range.start > mergeGapMs) {
    push(range.start, sorted[0].t, null);
  }
  sorted.forEach((sample, index) => {
    const next = index + 1 < sorted.length ? sorted[index + 1].t : range.end;
    const end = sample.t + stepMs;
    if (next !== undefined && next - end <= mergeGapMs) {
      push(sample.t, next, sample.state);
      return;
    }
    push(sample.t, end, sample.state);
    if (next !== undefined) push(end, next, null);
  });
  return segments;
};

/** One query's PromQL step or SQL histogram interval in ms, else the smallest gap between its samples. */
export const resolveStateTimelineStep = (
  samplesByRow: StateSample[][],
  queryMetaData: any,
  isPromQL: boolean,
): number => {
  const meta = queryMetaData?.[0];
  if (isPromQL && Number(meta?.step) > 0) return Number(meta.step) / 1000;
  if (!isPromQL && Number(meta?.histogram_interval) > 0) {
    return Number(meta.histogram_interval) * 1000;
  }
  let smallest = Infinity;
  samplesByRow.forEach((samples) => {
    const times = samples.map((sample) => sample.t).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const delta = times[i] - times[i - 1];
      if (delta > 0 && delta < smallest) smallest = delta;
    }
  });
  return Number.isFinite(smallest) ? smallest : FALLBACK_STEP_MS;
};

const queryLabel = (query: any, queryIndex: number): string =>
  [query?.tabName, query?.config?.query_label].find(
    (text: unknown) => typeof text === "string" && text !== "" && !text.includes("{"),
  ) ?? gt("common.queryNumber", { index: queryIndex + 1 });

/** Suffixes names that collide across queries with the query's label, and keeps every final name unique. */
const disambiguateRowNames = (rows: ExtractedRow[]): ExtractedRow[] => {
  const groups = new Map<string, ExtractedRow[]>();
  rows.forEach((row) => {
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name)!.push(row);
  });
  groups.forEach((group, name) => {
    if (group.length < 2) return;
    group.forEach((row) => {
      row.entity = name;
      row.name = `${name} (${row.label})`;
    });
  });
  // Two queries can share a label, so a name that still collides takes an ordinal.
  const taken = new Set<string>();
  rows.forEach((row) => {
    let name = row.name;
    for (let ordinal = 2; taken.has(name); ordinal++) name = `${row.name} (${ordinal})`;
    if (name !== row.name) {
      row.entity = row.entity ?? row.name;
      row.name = name;
    }
    taken.add(name);
  });
  return rows;
};

const promqlRows = (
  panelSchema: any,
  data: any[],
  metadata: any,
  resultMetaData: any,
  store: any,
) => {
  // A time-shifted window is not an entity of its own.
  const primaries = data
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !metadata?.queries?.[index]?.timeRangeGap?.seconds);
  const queryIndexOf = (index: number) => metadata?.queries?.[index]?.panelQueryIndex ?? index;
  const names = buildPromqlSeriesNames(
    primaries.map(({ entry, index }) => ({
      metrics: (entry?.result ?? []).map((m: any) => m?.metric).filter(Boolean),
      template: panelSchema.queries?.[queryIndexOf(index)]?.config?.promql_legend,
      fallback: legendFallbackOf(panelSchema.queries, queryIndexOf(index)),
    })),
    getCachedSemanticGroups(store?.state?.selectedOrganization?.identifier ?? "") ?? [],
  );
  // The legend names the entity, so a series that changed a label (an exporter restart) stays one row.
  const rows: ExtractedRow[] = [];
  primaries.forEach(({ entry, index }) => {
    const byName = new Map<string, { metric: any; samples: StateSample[]; last: number }[]>();
    (entry?.result ?? []).forEach((metric: any) => {
      const samples = (metric?.values ?? (metric?.value ? [metric.value] : [])).map(
        ([ts, value]: [number, unknown]) => ({ t: Number(ts) * 1000, state: toPromqlState(value) }),
      );
      const last = samples.reduce(
        (max: number, sample: StateSample) => Math.max(max, sample.t),
        -Infinity,
      );
      const name = names.get(metric?.metric) ?? "";
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push({ metric: metric?.metric, samples, last });
    });
    byName.forEach((series, name) => {
      // The most recent series wins a shared timestamp and lends the row its labels.
      const ordered = [...series].sort((a, b) => a.last - b.last);
      const byTime = new Map<number, StateSample>();
      ordered.forEach(({ samples }) => samples.forEach((sample) => byTime.set(sample.t, sample)));
      rows.push({
        name,
        labels: { ...(ordered[ordered.length - 1].metric ?? {}) },
        query: index,
        label: queryLabel(panelSchema.queries?.[queryIndexOf(index)], queryIndexOf(index)),
        samples: [...byTime.values()].sort((a, b) => a.t - b.t),
        meta: resultMetaData?.[index],
      });
    });
  });
  return disambiguateRowNames(rows);
};

/** Pairs each SQL result slot with its query and response metadata, leaving out time-shifted slots. */
const sqlSlots = (panelSchema: any, data: any[], metadata: any, resultMetaData: any) => {
  const queries: any[] = panelSchema.queries ?? [];
  const metas: any[] = metadata?.queries ?? [];
  if (!metas.length) {
    const aligned = Array.isArray(resultMetaData) && resultMetaData.length === data.length;
    return queries.map((query, index) => ({
      query,
      index,
      slot: index,
      meta: aligned ? resultMetaData[index] : undefined,
    }));
  }
  // A time shift adds result slots after its primary, and each slot names its panel query.
  if (metas.length === data.length) {
    return metas.flatMap((meta, slot) => {
      if (meta?.timeRangeGap?.seconds) return [];
      const index = meta?.panelQueryIndex ?? slot;
      return [{ query: queries[index], index, slot, meta: resultMetaData?.[slot] }];
    });
  }
  // Hidden queries leave the data but not the metadata, so each shown query finds its own by its text.
  let from = 0;
  return queries.map((query, index) => {
    const found = metas.findIndex(
      (meta, k) =>
        k >= from && !meta?.timeRangeGap?.seconds && meta?.originalQuery === query?.query,
    );
    if (found >= 0) from = found + 1;
    return { query, index, slot: index, meta: found >= 0 ? resultMetaData?.[found] : undefined };
  });
};

const sqlRows = (panelSchema: any, data: any[], metadata: any, resultMetaData: any) => {
  // Two queries can return the same entity, so a row belongs to one query.
  const rows = new Map<string, ExtractedRow>();
  sqlSlots(panelSchema, data, metadata, resultMetaData).forEach(({ query, index, slot, meta }) => {
    const x = query?.fields?.x?.[0];
    const y = query?.fields?.y?.[0];
    const breakdown = query?.fields?.breakdown?.[0];
    if (!x || !y || !Array.isArray(data?.[slot])) return;
    data[slot].forEach((item: any) => {
      const t = toEpochMs(getDataValue(item, x.alias));
      if (!Number.isFinite(t)) return;
      const entity = breakdown ? String(getDataValue(item, breakdown.alias) ?? "") : null;
      const name = entity ?? (y.label || y.alias);
      const key = `${index}\u0000${name}`;
      if (!rows.has(key)) {
        rows.set(key, {
          name,
          labels: entity === null ? {} : { [stateTimelineBreakdownColumn(breakdown)]: entity },
          samples: [],
          query: index,
          label: queryLabel(query, index),
          meta,
        });
      }
      rows.get(key)!.samples.push({ t, state: toState(getDataValue(item, y.alias)) });
    });
  });
  return disambiguateRowNames([...rows.values()]);
};

const SCOPE_SEPARATOR = "\u0001";

/** The style key of a state in a row's scope; a row override can style one state its own way. */
export const styleKeyOf = (scope: string | undefined, state: string) =>
  `${scope ?? ""}${SCOPE_SEPARATOR}${state}`;

/** Total time each state is in effect per style scope. */
const scopedDurations = (rows: { scope?: string; segments: StateSegment[] }[]) => {
  const total = new Map<string, number>();
  rows.forEach((row) =>
    row.segments.forEach((segment) => {
      if (segment.state === null) return;
      const key = styleKeyOf(row.scope, segment.state);
      total.set(key, (total.get(key) ?? 0) + segment.end - segment.start);
    }),
  );
  return total;
};

/** Total time each state is in effect across the rows; no data is not a state. */
const stateDurations = (rows: { segments: StateSegment[] }[]) => {
  const total = new Map<string, number>();
  rows.forEach((row) =>
    row.segments.forEach((segment) => {
      if (segment.state === null) return;
      total.set(segment.state, (total.get(segment.state) ?? 0) + segment.end - segment.start);
    }),
  );
  return total;
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Rows sorted by name, or by time spent outside the state with the most total time. */
export const sortStateRows = <T extends { name: string; segments: StateSegment[] }>(
  rows: T[],
  sort: StateTimelineSort,
): T[] => {
  if (sort !== "non_ok_time") return [...rows].sort(byName);
  const dominant = [...stateDurations(rows).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const nonOk = (row: T) =>
    row.segments.reduce(
      (sum, segment) => (segment.state !== dominant ? sum + segment.end - segment.start : sum),
      0,
    );
  return rows
    .map((row) => ({ row, nonOk: nonOk(row) }))
    .sort((a, b) => b.nonOk - a.nonOk || byName(a.row, b.row))
    .map(({ row }) => row);
};

const numericRange = (states: string[]) => {
  const values = states.map(Number).filter((value) => Number.isFinite(value));
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Styles per state; states sharing display text and colour share one style, and only unmapped ones count toward the cap. */
const buildStateStyles = (
  durations: Map<string, number>,
  scopes: Map<string, StyleScope>,
  config: any,
  theme: string,
) => {
  const panelCache = buildValueMappingCache(config?.mappings);
  const keys = [...durations.keys()].sort(byText);
  const stateOf = (key: string) => key.slice(key.indexOf(SCOPE_SEPARATOR) + 1);
  const scopeOf = (key: string) => key.slice(0, key.indexOf(SCOPE_SEPARATOR));
  const lookups = new Map<string, { cache: any; thresholds: any }>();
  const lookupOf = (scope: string) => {
    if (!lookups.has(scope)) {
      const own = scopes.get(scope);
      const normalized = normalizeThresholds(own?.thresholds ?? config?.thresholds);
      // Panel thresholds span every row; only a row's own thresholds read its own states.
      const states = own?.thresholds
        ? keys.filter((key) => scopeOf(key) === scope).map(stateOf)
        : keys.map(stateOf);
      lookups.set(scope, {
        cache: own?.mappings ? buildValueMappingCache(own.mappings) : null,
        thresholds: normalized ? resolveStepValues(normalized, numericRange(states)) : null,
      });
    }
    return lookups.get(scope)!;
  };

  const groups = new Map<string, StateGroup>();
  keys.forEach((styleKey) => {
    const state = stateOf(styleKey);
    const { cache, thresholds } = lookupOf(scopeOf(styleKey));
    // A row's own mapping wins over the panel's.
    const mapping =
      lookupValueMappingFull(state, cache) ?? lookupValueMappingFull(state, panelCache);
    const text = mapping?.text ? String(mapping.text) : state;
    const numeric = state.trim() !== "" && Number.isFinite(Number(state));
    const thresholdColor =
      !mapping?.color && numeric && thresholds ? stepColorFor(state, thresholds, null) : null;
    // States share a style only when their text and their configured colour both match.
    const key = `${text}\u0000${mapping?.color || thresholdColor || ""}\u0000${mapping?.textColor || ""}`;
    const group = groups.get(key) ?? {
      text,
      duration: 0,
      states: [],
      mappedColor: null,
      thresholdColor: null,
      textColor: null,
    };
    group.duration += durations.get(styleKey) ?? 0;
    group.states.push(styleKey);
    group.mappedColor = group.mappedColor || mapping?.color || null;
    group.textColor = group.textColor || mapping?.textColor || null;
    group.thresholdColor = group.thresholdColor || thresholdColor;
    groups.set(key, group);
  });

  const byDuration = (a: StateGroup, b: StateGroup) =>
    b.duration - a.duration || byText(a.text, b.text);
  const unmapped = [...groups.values()].filter((group) => !group.mappedColor).sort(byDuration);
  // The cap counts raw states, since one state can sit in several groups across row scopes.
  const rawStates = (group: StateGroup) => group.states.map(stateOf);
  const kept = new Set<string>();
  const capped = new Set<StateGroup>();
  unmapped.forEach((group) => {
    const added = rawStates(group).filter((state) => !kept.has(state));
    if (added.length && kept.size + added.length > STATE_TIMELINE_MAX_STATES) {
      capped.add(group);
      return;
    }
    added.forEach((state) => kept.add(state));
  });
  const unmappedStates = new Set(unmapped.flatMap(rawStates));

  // Probing from each state's hash slot keeps colours distinct; sorted order makes them repeatable.
  // The series palette has 12 colours; the trace span colours extend it past the 20-state cap.
  const palette = [...new Set([...getColorPalette(theme), ...getAllSpanColors()])];
  const taken = new Set<number>();
  const paletteColor = new Map<StateGroup, string>();
  [...groups.values()]
    .filter((group) => !group.mappedColor && !group.thresholdColor && !capped.has(group))
    .sort((a, b) => byText(a.text, b.text))
    .forEach((group) => {
      const home = getSeriesHash(group.text, palette);
      const free = palette.findIndex((_, i) => !taken.has((home + i) % palette.length));
      const slot = free === -1 ? home : (home + free) % palette.length;
      taken.add(slot);
      paletteColor.set(group, palette[slot]);
    });

  const otherColor = chartColor("--color-text-secondary");
  const styles = new Map<string, StateStyle>();
  groups.forEach((group) => {
    const color = capped.has(group)
      ? otherColor
      : group.mappedColor || group.thresholdColor || paletteColor.get(group) || otherColor;
    const style = {
      text: group.text,
      color,
      textColor:
        group.textColor ||
        getContrastColor(color, chartColor("--color-text-heading"), CONTRAST_THRESHOLD),
    };
    group.states.forEach((state) => styles.set(state, style));
  });

  // The legend keys entries by name, so a second entry with the same text gets an invisible suffix.
  const used = new Set<string>();
  const uniqueName = (text: string) => {
    let name = text;
    while (used.has(name)) name += "\u200b";
    used.add(name);
    return name;
  };
  const legend = [...groups.values()]
    .filter((group) => !capped.has(group))
    .sort(byDuration)
    .map((group) => ({
      name: uniqueName(group.text),
      color: styles.get(group.states[0])!.color,
    }));
  if (capped.size)
    legend.push({ name: uniqueName(gt("dashboard.utils.stateTimelineOther")), color: otherColor });
  return { styles, legend, unmappedCount: unmappedStates.size, shownStates: kept.size };
};

const capNotice = (
  totalRows: number,
  shownRows: number,
  totalStates: number,
  shownStates: number,
) => {
  const notices: string[] = [];
  if (totalRows > shownRows) {
    notices.push(
      gt("dashboard.utils.stateTimelineRowCap", {
        shown: addCommasToNumber(shownRows),
        total: addCommasToNumber(totalRows),
      }),
    );
  }
  if (totalStates > shownStates) {
    notices.push(
      gt("dashboard.utils.stateTimelineStateCap", {
        shown: addCommasToNumber(shownStates),
        total: addCommasToNumber(totalStates),
      }),
    );
  }
  return notices.join(" ");
};

const positiveOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number) && number >= 0
    ? number
    : fallback;
};

/** The row window a rendered option shows, or null when its rows do not scroll. */
export const readRowWindow = (option: any): RowWindow | null => {
  const zoom = (option?.dataZoom ?? []).find((item: any) =>
    STATE_TIMELINE_ROW_ZOOM_IDS.includes(item?.id),
  );
  const names: string[] = option?.yAxis?.[0]?.data ?? [];
  if (!zoom || !names.length) return null;
  const start = Number(zoom.startValue);
  return { anchor: names[start], start, end: Number(zoom.endValue) };
};

/** The window a row-scroll event moved the options to; wheel and slider events carry only a percentage range. */
export const rowWindowFromEvent = (options: any, event: any): RowWindow | null => {
  const names: string[] = options?.yAxis?.[0]?.data ?? [];
  if (!readRowWindow(options) || !event) return null;
  const last = names.length - 1;
  // ECharts rounds a percentage window on an ordinal axis to whole indexes the same way (toFixed(0)).
  const at = (value: unknown, percent: unknown) =>
    value != null ? Number(value) : Number(((Number(percent ?? 0) / 100) * last).toFixed(0));
  const clamp = (index: number) => Math.max(0, Math.min(index, last));
  const start = clamp(at(event.startValue, event.start));
  const end = clamp(at(event.endValue, event.end));
  return { anchor: names[start], start, end };
};

/** Next options scrolled back to the previous window, anchored on its first row when that row survives. */
export const withRowWindow = (options: any, previous: RowWindow | null) => {
  const names: string[] = options?.yAxis?.[0]?.data ?? [];
  const zooms: any[] = options?.dataZoom ?? [];
  const zoom = zooms.find((item) => STATE_TIMELINE_ROW_ZOOM_IDS.includes(item?.id));
  if (!previous || !zoom) return options;
  const size = zoom.endValue - zoom.startValue + 1;
  const anchored = names.indexOf(previous.anchor);
  const start = Math.max(
    0,
    Math.min(anchored >= 0 ? anchored : previous.start, names.length - size),
  );
  return {
    ...options,
    dataZoom: zooms.map((item) =>
      STATE_TIMELINE_ROW_ZOOM_IDS.includes(item?.id)
        ? { ...item, startValue: start, endValue: start + size - 1 }
        : item,
    ),
  };
};

/** The state of a row at a time, by binary search over its time-ordered segments; null is no data. */
export const stateAt = (segments: StateSegment[], t: number): string | null => {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].end <= t) low = mid + 1;
    else if (segments[mid].start > t) high = mid - 1;
    else return segments[mid].state;
  }
  return null;
};

/** Tooltip lines for every row in view at one time, capped with a "+N more" line. */
export const allRowsTooltip = (
  rows: { name: string; displayName?: string; scope?: string; segments: StateSegment[] }[],
  styles: Map<string, StateStyle>,
  t: number,
  timezone: string,
  view: { start: number; end: number },
): string => {
  const visible = rows.slice(view.start, view.end + 1);
  const noData = gt("dashboard.utils.stateTimelineNoData");
  const lines = visible.slice(0, STATE_TIMELINE_TOOLTIP_MAX_ROWS).map((row) => {
    const state = stateAt(row.segments, t);
    const style = state === null ? null : styles.get(styleKeyOf(row.scope, state));
    const marker = echartsFormat.getTooltipMarker(
      style ? style.color : chartColor("--color-border-strong"),
    );
    const label = row.displayName ?? row.name;
    return `${marker}${escapeHtml(label)}: ${escapeHtml(style ? style.text : noData)}`;
  });
  if (visible.length > STATE_TIMELINE_TOOLTIP_MAX_ROWS) {
    const more = visible.length - STATE_TIMELINE_TOOLTIP_MAX_ROWS;
    lines.push(escapeHtml(gt("dashboard.utils.stateTimelineMoreRows", { count: more })));
  }
  const time = formatDate(toZonedTime(t, timezone));
  return [`<strong>${escapeHtml(time)}</strong>`, ...lines].join("<br/>");
};

// A fixed span stops a pinch zoom; zoomLock would also drop the wheel listener, and a zero span cannot move.
const rowWheelZoom = (visibleRows: number) => ({
  id: STATE_TIMELINE_ROW_ZOOM_IDS[1],
  type: "inside",
  yAxisIndex: 0,
  startValue: 0,
  endValue: visibleRows - 1,
  minValueSpan: visibleRows - 1,
  maxValueSpan: visibleRows - 1,
  zoomOnMouseWheel: false,
  moveOnMouseWheel: true,
  moveOnMouseMove: false,
  preventDefaultMouseMove: false,
  filterMode: "filter",
});

/** The series cap the PromQL loader applies to a panel; a state timeline merges series into rows, so it has its own. */
export const promqlSeriesCap = (panelType: string | undefined, zoConfig: any): number =>
  panelType === "state-timeline"
    ? (zoConfig?.max_dashboard_state_timeline_series ?? STATE_TIMELINE_MAX_SERIES)
    : (zoConfig?.max_dashboard_series ?? 100);

/** The raw row behind a clicked segment: in SQL the entity's row at or just before the segment start, in PromQL its labels. */
export const stateTimelineSourceRecord = (
  panelSchema: any,
  data: any,
  params: any,
): Record<string, any> => {
  const segment = params?.data;
  if (!segment) return {};
  const labels = { ...(segment.labels ?? {}) };
  if (panelSchema?.queryType === "promql") return labels;
  const entity = segment.entity ?? segment.name;
  let before: { row: any; t: number } | null = null;
  let earliest: { row: any; t: number } | null = null;
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const x = query?.fields?.x?.[0];
    const breakdown = query?.fields?.breakdown?.[0];
    if (!x || !Array.isArray(data?.[index])) return;
    data[index].forEach((row: any) => {
      if (breakdown && String(getDataValue(row, breakdown.alias) ?? "") !== entity) return;
      const t = toEpochMs(getDataValue(row, x.alias));
      if (!Number.isFinite(t)) return;
      if (t <= segment.start && (!before || t > before.t)) before = { row, t };
      if (!earliest || t < earliest.t) earliest = { row, t };
    });
  });
  return (before as any)?.row ?? (earliest as any)?.row ?? labels;
};

/** The column a breakdown field reads; builder aliases are only breakdown_1, custom SQL has just the alias. */
export const stateTimelineBreakdownColumn = (field: any): string =>
  field?.column || field?.args?.[0]?.value?.field || field?.alias;

/** Drilldown variables for a clicked segment: entity, state, its labels and start/end in ms. */
export const stateTimelineDrilldownSeries = (params: any) => ({
  __name: params?.data?.entity ?? params?.data?.name ?? "",
  __value: params?.data?.state ?? "",
  __axisValue: params?.data?.start,
  __start: params?.data?.start,
  __end: params?.data?.end,
  labels: params?.data?.labels ?? {},
});

/** Converts SQL or PromQL results into a state timeline: one band per entity, one rectangle per state run. */
export const convertStateTimelineData = (
  panelSchema: any,
  data: any,
  store: any,
  chartPanelRef: any,
  resultMetaData: any,
  metadata: any,
  hoveredSeriesState?: any,
  annotations?: any,
) => {
  if (!Array.isArray(data) || !panelSchema) return { options: null };
  const config = panelSchema.config ?? {};
  const isPromQL = panelSchema.queryType === "promql";
  const timezone = store?.state?.timezone ?? "UTC";
  const extracted = isPromQL
    ? promqlRows(panelSchema, data, metadata, resultMetaData, store)
    : sqlRows(panelSchema, data, metadata, resultMetaData);

  // The renderer reads an empty series list as "No Data", as it does for line panels.
  if (!extracted.some((row) => row.samples.length)) {
    return { options: { series: [] }, extras: { panelId: panelSchema.id } };
  }

  const stepByQuery = new Map<number, number>();
  const stepOf = (query: number) => {
    if (!stepByQuery.has(query)) {
      const queryRows = extracted.filter((row) => row.query === query);
      const samples = queryRows.map((row) => row.samples);
      stepByQuery.set(query, resolveStateTimelineStep(samples, queryRows[0]?.meta, isPromQL));
    }
    return stepByQuery.get(query)!;
  };
  const mergeGapSeconds = positiveOr(config.merge_gaps, -1);
  const queryMeta = metadata?.queries?.[0];
  const range = {
    start: queryMeta?.startTime ? Number(queryMeta.startTime) / 1000 : undefined,
    end: queryMeta?.endTime ? Number(queryMeta.endTime) / 1000 : undefined,
  };

  const allRows: StateRow[] = extracted.map((row) => {
    const stepMs = stepOf(row.query);
    const mergeGapMs =
      mergeGapSeconds >= 0 ? mergeGapSeconds * 1000 : stepMs * AUTO_MERGE_GAP_FACTOR;
    return { ...row, segments: buildStateSegments(row.samples, stepMs, mergeGapMs, range) };
  });
  const sorted = sortStateRows(allRows, config.row_sort === "non_ok_time" ? "non_ok_time" : "name");
  const rows = sorted.slice(0, STATE_TIMELINE_MAX_ROWS);
  const scopes = new Map<string, StyleScope>();
  rows.forEach((row) => {
    // Overrides match the raw entity, so a suffix added to tell rows apart never changes a match.
    const override = resolveSeriesOverride(config, row.entity ?? row.name);
    if (override?.displayName) row.displayName = override.displayName;
    if (!override?.valueMappings && !override?.thresholds) return;
    const scope = { mappings: override.valueMappings, thresholds: override.thresholds };
    row.scope = JSON.stringify(scope);
    scopes.set(row.scope, scope);
  });
  const { styles, legend, unmappedCount, shownStates } = buildStateStyles(
    scopedDurations(rows),
    scopes,
    config,
    store?.state?.theme,
  );
  const stateList = [...styles.keys()];
  const styleIndex = new Map(stateList.map((state, index) => [state, index]));

  const rowHeight = positiveOr(config.row_height, DEFAULT_ROW_HEIGHT) || DEFAULT_ROW_HEIGHT;
  const rowGap = positiveOr(config.row_gap, DEFAULT_ROW_GAP);
  const showText = config.show_state_text !== false;
  const showLegend = config.show_legends !== false;
  const noDataFill = chartColor("--color-surface-subtle");
  const noDataBorder = chartColor("--color-border-strong");
  // Segment bounds and sample times repeat across rows, so each instant is converted once.
  const zonedDates = new Map<number, Date>();
  const crosshairX = (ms: number) => {
    let date = zonedDates.get(ms);
    if (!date) {
      date = toZonedTime(ms, timezone);
      zonedDates.set(ms, date);
    }
    return date;
  };
  const zoned = (ms: number) => crosshairX(ms).getTime();
  const hasNoData = rows.some((row) => row.segments.some((segment) => segment.state === null));

  const segmentData = rows.flatMap((row, rowIndex) =>
    row.segments.map((segment) => {
      const styleKey = segment.state === null ? null : styleKeyOf(row.scope, segment.state);
      const style = styleKey === null ? null : styles.get(styleKey)!;
      return {
        value: [
          zoned(segment.start),
          zoned(segment.end),
          rowIndex,
          styleKey === null ? NO_DATA_STYLE : styleIndex.get(styleKey)!,
        ],
        name: row.name,
        displayName: row.displayName ?? row.name,
        entity: row.entity,
        labels: row.labels,
        state: segment.state,
        start: segment.start,
        end: segment.end,
        itemStyle: { color: style ? style.color : noDataFill },
      };
    }),
  );

  // The crosshair line snaps to sample times, the same instants line panels hover on.
  const distinctTimes = new Set<number>();
  for (const row of rows) for (const sample of row.samples) distinctTimes.add(sample.t);
  const sampleTimes = [...distinctTimes].sort((a, b) => a - b);

  const { markLines, markAreas } = getAnnotationsData(annotations, timezone);
  const hasAnnotations = markLines.length > 0 || markAreas.length > 0;
  // Annotation labels sit above the plot, so they need a line of room or the grid edge cuts them.
  const gridTop = GRID_TOP + (hasAnnotations ? ANNOTATION_LABEL_ROOM : 0);

  const chartHeight = chartPanelRef?.value?.offsetHeight ?? 0;
  const chartWidth = chartPanelRef?.value?.offsetWidth ?? 0;
  const bandHeight = rowHeight + rowGap;
  const bottom = X_AXIS_ROOM + (showLegend ? LEGEND_ROOM : 0);
  const fitRows = chartHeight
    ? Math.max(1, Math.floor((chartHeight - gridTop - bottom) / bandHeight))
    : rows.length;
  const visibleRows = Math.max(1, Math.min(rows.length, fitRows));
  const scrolls = rows.length > visibleRows;
  const displayNames = new Map(
    rows.filter((row) => row.displayName).map((row) => [row.name, row.displayName!]),
  );
  const longestName = rows.reduce(
    (longest, row) => Math.max(longest, (row.displayName ?? row.name).length),
    0,
  );
  const maxLabelWidth = chartWidth ? Math.min(200, chartWidth * 0.3) : 200;
  const labelWidth = Math.max(40, Math.min(maxLabelWidth, longestName * 7));

  const legendSeries: any[] = legend.map(({ name, color }) => ({
    type: "custom",
    name,
    data: [],
    renderItem: () => null,
    itemStyle: { color },
  }));
  if (hasNoData) {
    legendSeries.push({
      type: "custom",
      name: gt("dashboard.utils.stateTimelineNoData"),
      data: [],
      renderItem: () => null,
      itemStyle: {
        color: noDataFill,
        borderColor: noDataBorder,
        borderType: "dashed",
        borderWidth: 1,
      },
    });
  }

  const renderItem = (params: any, api: any) => {
    const from = api.coord([api.value(0), api.value(2)]);
    const to = api.coord([api.value(1), api.value(2)]);
    const height = Math.max(1, api.size([0, 1])[1] - rowGap);
    const box = params.coordSys;
    // Wall-clock x runs backwards across a DST fall-back, so a segment's end can sit left of its start.
    const x1 = Math.max(Math.min(from[0], to[0]), box.x);
    const x2 = Math.min(Math.max(from[0], to[0]), box.x + box.width);
    if (x2 <= x1) return null;
    const styleId = api.value(3);
    const styleKey = styleId === NO_DATA_STYLE ? null : stateList[styleId];
    const style = styleKey === null ? null : styles.get(styleKey)!;
    const rect = {
      type: "rect",
      shape: { x: x1, y: from[1] - height / 2, width: x2 - x1, height },
      style:
        style === null
          ? { fill: noDataFill, stroke: noDataBorder, lineWidth: 1, lineDash: [3, 3] }
          : { fill: style.color },
    };
    if (!showText || style === null || x2 - x1 < MIN_TEXT_WIDTH) return rect;
    return {
      type: "group",
      children: [
        rect,
        {
          type: "text",
          silent: true,
          style: {
            text: style.text,
            x: x1 + TEXT_PADDING,
            y: from[1],
            verticalAlign: "middle",
            fill: style.textColor,
            fontSize: 11,
            width: x2 - x1 - TEXT_PADDING * 2,
            overflow: "truncate",
          },
        },
      ],
    };
  };

  const listsAllRows = config.tooltip_mode === "all_rows";
  const view = { start: 0, end: visibleRows - 1 };
  const pointer: { zoned: number | null } = { zoned: null };
  const allRowsFormatter = (params: any) => {
    // A crosshair from another panel moves this axis too; only the hovered panel lists its rows.
    const hoveredPanel = hoveredSeriesState?.value?.panelId;
    if (hoveredPanel && hoveredPanel !== -1 && hoveredPanel !== panelSchema.id) return "";
    const sample = (Array.isArray(params) ? params : [params]).find(
      (item: any) => item?.seriesIndex === 1,
    );
    // The renderer reports the pointer; the axis only offers the nearest sample, which misreads a gap.
    const t =
      pointer.zoned !== null
        ? fromZonedTime(new Date(pointer.zoned), timezone).getTime()
        : sampleTimes[sample?.dataIndex];
    return t === undefined ? "" : allRowsTooltip(rows, styles, t, timezone, view);
  };
  const tooltipFormatter = (params: any) => {
    const item = params?.data;
    if (params?.seriesIndex !== 0 || !item) return "";
    const text =
      item.state === null
        ? gt("dashboard.utils.stateTimelineNoData")
        : styles.get(stateList[item.value[3]])!.text;
    return [
      `<strong>${escapeHtml(item.displayName ?? item.name)}</strong>`,
      `${params.marker} ${escapeHtml(text)}`,
      `${escapeHtml(gt("dashboard.utils.stateTimelineStart"))}: ${formatDate(new Date(item.value[0]))}`,
      `${escapeHtml(gt("dashboard.utils.stateTimelineEnd"))}: ${formatDate(new Date(item.value[1]))}`,
      `${escapeHtml(gt("dashboard.utils.stateTimelineDuration"))}: ${escapeHtml(
        durationFormatter(Math.round((item.end - item.start) / 1000)),
      )}`,
    ].join("<br/>");
  };

  // Annotations sit after the crosshair series so crosshairSeriesIndex stays 1; a vertical line spans every row.
  const annotationSeries = hasAnnotations
    ? [
        {
          type: "line",
          yAxisIndex: 1,
          data: [[crosshairX(sampleTimes[0] ?? range.start ?? 0), null]],
          symbol: "none",
          tooltip: { show: false },
          z: ANNOTATION_Z,
          markLine: {
            z: ANNOTATION_Z,
            silent: false,
            animation: false,
            itemStyle: { color: chartColor("--color-text-secondary") },
            data: markLines,
          },
          markArea: {
            z: ANNOTATION_Z,
            itemStyle: { color: CHART_SELECTION_FILL },
            data: markAreas,
          },
        },
      ]
    : [];

  const options: any = {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      top: gridTop,
      left: labelWidth + 12,
      right: scrolls ? SCROLLBAR_ROOM : 16,
      height: visibleRows * bandHeight,
    },
    tooltip: {
      show: true,
      trigger: listsAllRows ? "axis" : "item",
      ...(listsAllRows ? { axisPointer: { type: "line", axis: "x" } } : {}),
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      borderWidth: 1,
      padding: [8, 12],
      formatter: listsAllRows ? allRowsFormatter : tooltipFormatter,
    },
    legend: {
      show: showLegend,
      type: "scroll",
      bottom: 0,
      left: "center",
      selectedMode: false,
      textStyle: { color: chartColor("--color-text-secondary") },
      data: legendSeries.map((series) => series.name),
    },
    xAxis: {
      type: "time",
      min: range.start !== undefined ? zoned(range.start) : undefined,
      max: range.end !== undefined ? zoned(range.end) : undefined,
      axisLabel: { hideOverlap: true },
      splitLine: {
        show: config.show_gridlines !== false,
        lineStyle: getGridLineStyle(store?.state?.theme),
      },
      axisPointer: {
        show: true,
        type: "line",
        snap: true,
        triggerTooltip: false,
        label: { show: false },
      },
    },
    yAxis: [
      {
        type: "category",
        inverse: true,
        // Names stay unique so the scroll anchor finds its row; a display name is only the label.
        data: rows.map((row) => row.name),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          interval: 0,
          formatter: (name: string) => displayNames.get(name) ?? name,
          width: labelWidth,
          overflow: "truncate",
          color: chartColor("--color-text-secondary"),
        },
      },
      { type: "value", show: false, min: 0, max: 1 },
    ],
    dataZoom: scrolls
      ? [
          {
            id: STATE_TIMELINE_ROW_ZOOM_IDS[0],
            type: "slider",
            yAxisIndex: 0,
            orient: "vertical",
            right: 4,
            width: 12,
            startValue: 0,
            endValue: visibleRows - 1,
            zoomLock: true,
            showDetail: false,
            showDataShadow: false,
            brushSelect: false,
            filterMode: "filter",
          },
          // The wheel moves rows; zoom and drag-pan stay off so neither competes with the time brush.
          ...(visibleRows > 1 ? [rowWheelZoom(visibleRows)] : []),
        ]
      : [],
    toolbox: {
      orient: "vertical",
      show: true,
      showTitle: false,
      tooltip: { show: false },
      itemSize: 0,
      itemGap: 0,
      bottom: "100%",
      feature: {
        dataZoom: { brushStyle: dataZoomBrushStyle(), filterMode: "none", yAxisIndex: "none" },
      },
    },
    series: [
      {
        type: "custom",
        renderItem,
        encode: { x: [0, 1], y: 2 },
        data: segmentData,
        tooltip: { trigger: listsAllRows ? "none" : "item" },
      },
      {
        type: "line",
        yAxisIndex: 1,
        data: sampleTimes.map((t) => [crosshairX(t), 0.5]),
        symbol: "none",
        silent: true,
        lineStyle: { opacity: 0 },
        emphasis: { disabled: true },
        tooltip: { trigger: "axis" },
      },
      ...annotationSeries,
      ...legendSeries,
    ],
  };

  const limiting = metadata?.seriesLimiting;
  const seriesNotice =
    isPromQL && limiting && (limiting.uniqueSeriesSeen ?? 0) > limiting.metricsStored
      ? gt("dashboard.utils.seriesLimitWarningCounts", {
          shown: addCommasToNumber(limiting.metricsStored),
          total: addCommasToNumber(limiting.uniqueSeriesSeen),
        })
      : "";
  const notice = [capNotice(sorted.length, rows.length, unmappedCount, shownStates), seriesNotice]
    .filter(Boolean)
    .join(" ");
  return {
    options,
    extras: {
      panelId: panelSchema.id,
      isTimeSeries: true,
      crosshairSeriesIndex: 1,
      // Overrides match each rendered row's raw entity, including a row that is all no data.
      rowEntities: rows.map((row) => row.entity ?? row.name),
      ...(scrolls ? { rowScroll: true } : {}),
      // The renderer reports the scrolled window so the all-rows tooltip lists what is in view.
      setRowWindow: (start: number, end: number) => {
        view.start = start;
        view.end = end;
      },
      ...(listsAllRows
        ? {
            setPointerTime: (zoned: number) => {
              pointer.zoned = Number.isFinite(zoned) ? zoned : null;
            },
          }
        : {}),
      ...(notice
        ? {
            seriesLimit: {
              shown: rows.length,
              total: sorted.length,
              cap: STATE_TIMELINE_MAX_ROWS,
              displayCapMessage: notice,
            },
          }
        : {}),
    },
  };
};
