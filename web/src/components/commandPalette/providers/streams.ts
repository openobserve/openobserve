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

import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

export type SearchableStreamType = "logs" | "metrics" | "traces";
export const STREAM_TYPES: SearchableStreamType[] = ["logs", "metrics", "traces"];
// One page per type on open; only a type with more streams than this needs live search.
export const LIST_PAGE = 1000;
const SEARCH_LIMIT = 20;
const MIN_SEARCH_LENGTH = 2;

interface StreamRow {
  name: string;
  stream_type: string;
}

function routeFor(type: string, name: string): PaletteItem["route"] {
  if (type === "metrics") return { name: "metrics", query: { search: name } };
  if (type === "traces") return { name: "traces", query: { stream: name } };
  return { name: "logs", query: { stream: name, stream_type: "logs", type: "stream_explorer" } };
}

function iconFor(type: string): string {
  if (type === "metrics") return "bar-chart";
  if (type === "traces") return "account-tree";
  return "window";
}

export function streamToItem(row: StreamRow, typeLabel: string, group?: string): PaletteItem {
  return {
    id: `stream:${row.stream_type}/${row.name}`,
    type: "stream",
    label: row.name,
    subtitle: typeLabel,
    icon: iconFor(row.stream_type),
    keywords: [row.stream_type],
    group,
    route: routeFor(row.stream_type, row.name),
  };
}

/** Lists every stream once on open; live keyword search runs only for types too large to list. */
export function createStreamsProvider(ctx: EntityProviderContext): EntityProvider {
  const typeLabel = (type: SearchableStreamType) => String(ctx.t(`palette.streamTypes.${type}`));
  const cached = (type: SearchableStreamType): StreamRow[] | null =>
    ctx.store.state.streams?.[type]?.list ?? null;
  const oversized = new Set<SearchableStreamType>();
  // A stream lives under its explorer's tile: logs, metrics or traces.
  const groupFor = (type: SearchableStreamType) => resolveGroup(ctx.railKeys, type, "data");
  const toItems = (type: SearchableStreamType, rows: StreamRow[]) =>
    rows.map((row) => streamToItem({ ...row, stream_type: type }, typeLabel(type), groupFor(type)));

  return {
    id: "streams",
    groups: STREAM_TYPES.map(groupFor).filter((g): g is string => !!g),
    enabled: () => ctx.hasRoute("logs"),
    list: async () => {
      const perType = await Promise.all(
        STREAM_TYPES.map(async (type) => {
          const warm = cached(type);
          if (warm) return toItems(type, warm);
          const res = await ctx.searchStreams(type, "", LIST_PAGE);
          const rows = res?.list ?? [];
          if ((res?.total ?? rows.length) > rows.length) oversized.add(type);
          return toItems(type, rows);
        }),
      );
      return perType.flat();
    },
    search: async (query) => {
      if (oversized.size === 0 || query.length < MIN_SEARCH_LENGTH) return [];
      const results = await Promise.all(
        [...oversized].map(async (type) => {
          const res = await ctx.searchStreams(type, query, SEARCH_LIMIT);
          return toItems(type, res?.list ?? []);
        }),
      );
      return results.flat();
    },
  };
}
