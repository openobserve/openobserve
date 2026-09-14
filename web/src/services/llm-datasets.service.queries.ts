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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import llmDatasetsService from "./llm-datasets.service";
import type { LlmDataset } from "./llm-datasets.service";
import { llmDatasetKeys } from "./llm-datasets.service.querykeys";

export const llmDatasetsQuery = (org: string) =>
  queryOptions({
    queryKey: llmDatasetKeys.list(org),
    queryFn: (): Promise<LlmDataset[]> => llmDatasetsService.list(org),
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** Every item write moves the item count the datasets list renders; the detail page re-reads itself. */
export const addDatasetTelemetryItemMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { datasetId: string; payload: any }) =>
      llmDatasetsService.addTelemetryItem(org, vars.datasetId, vars.payload),
    // The drawer renders its own success and failure toasts.
    meta: { invalidates: [llmDatasetKeys.all(org)], silentError: true },
  });

/** Add or edit one item, chosen by the caller. */
export const saveDatasetItemMutation = (org: string, itemId: () => string | null) =>
  mutationOptions({
    mutationFn: (vars: { datasetId: string; payload: any }) => {
      const id = itemId();
      return id
        ? llmDatasetsService.updateItem(org, vars.datasetId, id, vars.payload)
        : llmDatasetsService.addItem(org, vars.datasetId, vars.payload);
    },
    meta: { invalidates: [llmDatasetKeys.all(org)], silentError: true },
  });

export const removeDatasetItemMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { datasetId: string; itemId: string }) =>
      llmDatasetsService.removeItem(org, vars.datasetId, vars.itemId),
    meta: { invalidates: [llmDatasetKeys.all(org)], silentError: true },
  });

export const importDatasetItemsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { datasetId: string; file: File }) =>
      llmDatasetsService.importItems(org, vars.datasetId, vars.file),
    meta: { invalidates: [llmDatasetKeys.all(org)], silentError: true },
  });
