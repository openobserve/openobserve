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

import pipelinesService from "@/services/pipelines";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

interface PipelineRow {
  pipeline_id: string;
  name: string;
  enabled?: boolean;
  source?: { source_type?: string; stream_name?: string; stream_type?: string };
}

/** A pipeline row: id `pipeline:<id>`, opened in the pipeline editor. */
export function pipelineToItem(row: PipelineRow, group?: string): PaletteItem {
  const parts = [
    row.source?.source_type,
    row.source?.stream_name,
    row.enabled === false ? "paused" : "",
  ];
  return {
    id: `pipeline:${row.pipeline_id}`,
    type: "pipeline",
    label: row.name,
    subtitle: parts.filter(Boolean).join(" · "),
    icon: "lan",
    keywords: [
      row.pipeline_id,
      row.source?.stream_name ?? "",
      row.source?.source_type ?? "",
      "etl",
    ].filter(Boolean),
    group,
    route: { name: "pipelineEditor", query: { id: row.pipeline_id, name: row.name } },
  };
}

export function createPipelinesProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "data", "pipeline");
  return {
    id: "pipelines",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("pipelineEditor"),
    list: async (signal) => {
      const res = await pipelinesService.getPipelines(ctx.org, signal);
      const rows: PipelineRow[] = res?.data?.list ?? [];
      return rows.filter((r) => r.pipeline_id && r.name).map((r) => pipelineToItem(r, group));
    },
  };
}
