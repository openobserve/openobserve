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

import type { PaletteItem } from "../types";

export type SearchableStreamType = "logs" | "metrics" | "traces";
export const STREAM_TYPES: SearchableStreamType[] = ["logs", "metrics", "traces"];

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

/** A stream row: id `stream:<type>/<name>`, opened in the explorer for its type. */
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
