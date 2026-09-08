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

import useStreams from "@/composables/useStreams";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import type { EntityProviderContext } from "./context";

export type SearchableStreamType = "logs" | "metrics" | "traces";
export const STREAM_TYPES: SearchableStreamType[] = ["logs", "metrics", "traces"];
const SEARCH_LIMIT = 20;

interface StreamRow {
  name: string;
  stream_type: string;
}

function routeFor(type: string, name: string): PaletteItem["route"] {
  if (type === "metrics") return { name: "metrics", query: { search: name } };
  if (type === "traces") return { name: "traces", query: { stream: name } };
  return { name: "logs", query: { stream: name, stream_type: "logs", type: "stream_explorer" } };
}

export function streamToItem(row: StreamRow, typeLabel: string): PaletteItem {
  return {
    id: `stream:${row.stream_type}/${row.name}`,
    type: "stream",
    label: row.name,
    subtitle: typeLabel,
    icon:
      row.stream_type === "metrics"
        ? "bar-chart"
        : row.stream_type === "traces"
          ? "account-tree"
          : "window",
    keywords: [row.stream_type],
    route: routeFor(row.stream_type, row.name),
  };
}

/** Warm from the streams store when it is populated; otherwise keyword search per type. */
export function createStreamsProvider(ctx: EntityProviderContext): EntityProvider {
  const typeLabel = (type: SearchableStreamType) => String(ctx.t(`palette.streamTypes.${type}`));
  const cached = (type: SearchableStreamType): StreamRow[] =>
    ctx.store.state.streams?.[type]?.list ?? [];
  return {
    id: "streams",
    scope: "stream",
    enabled: () => ctx.hasRoute("logs"),
    list: async () =>
      STREAM_TYPES.flatMap((type) => cached(type).map((row) => streamToItem(row, typeLabel(type)))),
    search: async (query) => {
      const streams = useStreams(ctx.t);
      const results = await Promise.all(
        STREAM_TYPES.map(async (type) => {
          const res = (await streams.getPaginatedStreams(
            type,
            false,
            false,
            0,
            SEARCH_LIMIT,
            query,
          )) as {
            list?: StreamRow[];
          };
          return (res?.list ?? []).map((row) =>
            streamToItem({ ...row, stream_type: type }, typeLabel(type)),
          );
        }),
      );
      return results.flat();
    },
  };
}
