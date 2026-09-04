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

// Page-agnostic deep-link param engine (registry-driven build/apply/auto-run gate).

export type ParamScope = "panel" | "perQuery";

export interface ParamApplyCtx {
  index?: number;
  panelData?: any;
}

export interface ParamDescriptor<T = any> {
  key: string;
  // extra keys accepted on read, never emitted on build (e.g. legacy `stream`)
  aliases?: string[];
  scope: ParamScope; // per-query is indexed: bare ≡ .0, then .1, .2 …
  decode?: (raw: string) => T;
  encode?: (value: T) => string | null;
  apply: (target: any, value: T, ctx: ParamApplyCtx) => void;
  read?: (source: any, index?: number) => T | undefined | null;
}

export interface ApplyOptions {
  getQueries?: (state: any) => any[] | undefined;
  makeDefaultQuery?: () => any;
  onIndexApplied?: (slot: any, index: number, state: any) => void;
  // compact addressed indices to 0..N-1 (build-from-scratch); else honor literal index
  compactIndices?: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keysOf = (d: ParamDescriptor): string[] => [d.key, ...(d.aliases ?? [])];

const decodeValue = (d: ParamDescriptor, raw: any) => (d.decode ? d.decode(String(raw)) : raw);

const encodeValue = (d: ParamDescriptor, value: any): string | null =>
  d.encode ? d.encode(value) : String(value);

export const indexedKey = (key: string, i: number): string => (i === 0 ? key : `${key}.${i}`);

export const readIndexed = (query: Record<string, any>, key: string, i: number): any => {
  const dotted = query[`${key}.${i}`];
  if (dotted !== undefined) return dotted; // explicit .i wins (incl. .0)
  if (i === 0) return query[key]; // bare ≡ .0
  return undefined;
};

export const parseQueryIndices = (
  query: Record<string, any>,
  perQueryDescriptors: ParamDescriptor[],
): number[] => {
  const indices = new Set<number>();
  for (const d of perQueryDescriptors) {
    for (const key of keysOf(d)) {
      if (query[key] != null || query[`${key}.0`] != null) indices.add(0);
      const re = new RegExp(`^${escapeRegExp(key)}\\.(\\d+)$`);
      for (const k of Object.keys(query)) {
        const m = k.match(re);
        if (m) indices.add(parseInt(m[1], 10));
      }
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
};

export const hasAnyDeepLinkParam = (
  query: Record<string, any>,
  registry: ParamDescriptor[],
): boolean =>
  registry.some((d) =>
    keysOf(d).some((key) => {
      if (query[key] != null) return true;
      if (d.scope === "panel") return false;
      return Object.keys(query).some((k) => k.startsWith(`${key}.`));
    }),
  );

export const buildUrlFromRegistry = (url: URL, registry: ParamDescriptor[], intent: any): URL => {
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

export const applyOverridesFromRegistry = (
  registry: ParamDescriptor[],
  query: Record<string, any>,
  state: any,
  options: ApplyOptions = {},
): void => {
  const getQueries = options.getQueries ?? ((s: any) => s?.data?.queries as any[] | undefined);
  const makeDefaultQuery = options.makeDefaultQuery ?? (() => ({}));

  const panelDescriptors = registry.filter((d) => d.scope === "panel");
  const perQueryDescriptors = registry.filter((d) => d.scope === "perQuery");

  for (const d of panelDescriptors) {
    const key = keysOf(d).find((k) => query[k] != null); // first key/alias wins
    if (key != null) d.apply(state, decodeValue(d, query[key]), { panelData: state });
  }

  const queries = getQueries(state);
  if (Array.isArray(queries)) {
    const indices = parseQueryIndices(query, perQueryDescriptors);
    const baseLen = queries.length; // capture before appends
    indices.forEach((i, pos) => {
      // compact (build-from-scratch) maps to 0..N-1; else honor the literal index
      const target = options.compactIndices ? pos : i;
      let slot: any;
      if (target < baseLen && queries[target]) {
        slot = queries[target];
      } else {
        slot = makeDefaultQuery();
        queries.push(slot);
      }
      for (const d of perQueryDescriptors) {
        let raw: any;
        for (const key of keysOf(d)) {
          raw = readIndexed(query, key, i);
          if (raw !== undefined) break;
        }
        if (raw != null) d.apply(slot, decodeValue(d, raw), { index: target, panelData: state });
      }
      options.onIndexApplied?.(slot, target, state);
    });
  }

  if (state?.layout) state.layout.currentQueryIndex = 0;
};
