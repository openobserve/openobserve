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

// ---------------------------------------------------------------------------
// Page-agnostic deep-link param engine.
//
// A page describes the URL params it accepts as a list of `ParamDescriptor`s
// (its "registry"); this engine interprets them generically:
//   • indexing & aliasing — `key` ≡ `key.0`; `key.1`, `key.2` … ; explicit
//     ".i" wins over the bare key.
//   • build  — `buildUrlFromRegistry(url, registry, intent)` emits the params.
//   • apply  — `applyOverridesFromRegistry(registry, query, state)` reads them
//     back onto a target state, with override-or-append + gap compaction.
//   • gate   — `hasAnyDeepLinkParam(query, registry)` powers "auto-run on load".
//
// No metrics knowledge lives here — Add Panel / Logs Visualize can reuse it by
// supplying their own registry. The metrics registry is in
// `@/utils/metrics/metricsParamRegistry`.
// ---------------------------------------------------------------------------

export type ParamScope = "panel" | "perQuery";

export interface ParamApplyCtx {
  /** per-query slot index (perQuery scope only). */
  index?: number;
  /** the full target state (e.g. dashboardPanelData). */
  panelData?: any;
}

export interface ParamDescriptor<T = any> {
  /** URL param name, e.g. "chart_type" | "stream_name". */
  key: string;
  /** panel-level (applied once) | per-query (indexed: bare ≡ .0, then .1, .2 …). */
  scope: ParamScope;
  /** URL string -> value (default: identity). */
  decode?: (raw: string) => T;
  /** value -> URL string (default: String); may return null to skip emit. */
  encode?: (value: T) => string | null;
  /**
   * Land the decoded value onto the target:
   *   panel scope    -> target is the full state (dashboardPanelData)
   *   perQuery scope -> target is the query slot (queries[i])
   */
  apply: (target: any, value: T, ctx: ParamApplyCtx) => void;
  /**
   * Pull a value out of a build-intent (for buildUrlFromRegistry):
   *   panel scope    -> source is the intent
   *   perQuery scope -> source is the per-query intent (intent.queries[i])
   */
  read?: (source: any, index?: number) => T | undefined | null;
}

export interface ApplyOptions {
  /** Where the per-query array lives on the state (default: state.data.queries). */
  getQueries?: (state: any) => any[] | undefined;
  /** Factory for an appended query slot (default: () => ({})). */
  makeDefaultQuery?: () => any;
  /** Per-index post-hook (e.g. force a stream_type). Runs after descriptors. */
  onIndexApplied?: (slot: any, index: number, state: any) => void;
  /**
   * Compact addressed indices to contiguous slots `0..N-1` (use when BUILDING
   * FROM SCRATCH — no base blob — so `query.2` alone fills slot 0, no empty
   * middle queries). When false (default), honor the literal index so a base
   * (blob) query at `i` is overridden in place (surgical). Values are always
   * READ from the URL by their literal index regardless.
   */
  compactIndices?: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decodeValue = (d: ParamDescriptor, raw: any) =>
  d.decode ? d.decode(String(raw)) : raw;

const encodeValue = (d: ParamDescriptor, value: any): string | null =>
  d.encode ? d.encode(value) : String(value);

/** Build the URL key for an index: bare for 0 (the alias), `key.i` otherwise. */
export const indexedKey = (key: string, i: number): string =>
  i === 0 ? key : `${key}.${i}`;

/**
 * Read a per-query value at index `i`, treating the bare key as `.0` and
 * preferring the explicit `.i` (so `.0` wins over the bare key if both set).
 */
export const readIndexed = (
  query: Record<string, any>,
  key: string,
  i: number,
): any => {
  const dotted = query[`${key}.${i}`];
  if (dotted !== undefined) return dotted; // explicit ".i" (incl. ".0") wins
  if (i === 0) return query[key]; // bare ≡ .0
  return undefined;
};

/**
 * The addressed per-query indices for the given perQuery descriptors, sorted
 * unique. Index 0 is addressed by either the bare key or `.0`.
 */
export const parseQueryIndices = (
  query: Record<string, any>,
  perQueryDescriptors: ParamDescriptor[],
): number[] => {
  const indices = new Set<number>();
  for (const d of perQueryDescriptors) {
    if (query[d.key] != null || query[`${d.key}.0`] != null) indices.add(0);
    const re = new RegExp(`^${escapeRegExp(d.key)}\\.(\\d+)$`);
    for (const k of Object.keys(query)) {
      const m = k.match(re);
      if (m) indices.add(parseInt(m[1], 10));
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
};

/** True if any param in the registry is present on the query (auto-run gate). */
export const hasAnyDeepLinkParam = (
  query: Record<string, any>,
  registry: ParamDescriptor[],
): boolean =>
  registry.some((d) => {
    if (query[d.key] != null) return true;
    if (d.scope === "panel") return false;
    return Object.keys(query).some((k) => k.startsWith(`${d.key}.`));
  });

/**
 * Emit every registry param onto `url.searchParams` from a build-intent.
 * Per-query params are emitted indexed (bare for query 0).
 */
export const buildUrlFromRegistry = (
  url: URL,
  registry: ParamDescriptor[],
  intent: any,
): URL => {
  const p = url.searchParams;

  for (const d of registry) {
    if (d.scope !== "panel") continue;
    const v = d.read ? d.read(intent) : intent?.[d.key];
    if (v == null || v === "") continue;
    const enc = encodeValue(d, v);
    if (enc != null) p.set(d.key, enc);
  }

  const queries: any[] = intent?.queries ?? [];
  queries.forEach((qIntent, i) => {
    for (const d of registry) {
      if (d.scope !== "perQuery") continue;
      const v = d.read ? d.read(qIntent, i) : qIntent?.[d.key];
      if (v == null || v === "") continue;
      const enc = encodeValue(d, v);
      if (enc != null) p.set(indexedKey(d.key, i), enc);
    }
  });

  return url;
};

/**
 * Apply override params onto `state` (base = whatever is already there).
 * Panel descriptors apply once; per-query descriptors override `queries[i]`
 * in place when the base has it, else append a cloned default (compacting
 * non-contiguous indices). Precedence is override > base > default.
 */
export const applyOverridesFromRegistry = (
  registry: ParamDescriptor[],
  query: Record<string, any>,
  state: any,
  options: ApplyOptions = {},
): void => {
  const getQueries =
    options.getQueries ?? ((s: any) => s?.data?.queries as any[] | undefined);
  const makeDefaultQuery = options.makeDefaultQuery ?? (() => ({}));

  const panelDescriptors = registry.filter((d) => d.scope === "panel");
  const perQueryDescriptors = registry.filter((d) => d.scope === "perQuery");

  // Panel-level overrides (applied once).
  for (const d of panelDescriptors) {
    const raw = query[d.key];
    if (raw != null) d.apply(state, decodeValue(d, raw), { panelData: state });
  }

  // Per-query overrides (indexed).
  const queries = getQueries(state);
  if (Array.isArray(queries)) {
    const indices = parseQueryIndices(query, perQueryDescriptors);
    const baseLen = queries.length; // capture before appends
    indices.forEach((i, pos) => {
      // build-from-scratch -> compact to contiguous slots; blob base -> honor
      // the literal index so existing series are overridden surgically.
      const target = options.compactIndices ? pos : i;
      let slot: any;
      if (target < baseLen && queries[target]) {
        slot = queries[target]; // override in place
      } else {
        slot = makeDefaultQuery(); // cloned default
        queries.push(slot); // append at next position
      }
      for (const d of perQueryDescriptors) {
        const raw = readIndexed(query, d.key, i); // read by the literal url index
        if (raw != null)
          d.apply(slot, decodeValue(d, raw), { index: target, panelData: state });
      }
      options.onIndexApplied?.(slot, target, state);
    });
  }

  if (state?.layout) state.layout.currentQueryIndex = 0;
};
