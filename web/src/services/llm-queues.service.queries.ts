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
import llmQueuesService from "./llm-queues.service";
import type { LlmQueue } from "./llm-queues.service";
import { llmQueueKeys } from "./llm-queues.service.querykeys";
import { llmDatasetKeys } from "./llm-datasets.service.querykeys";

export const llmQueuesQuery = (org: string) =>
  queryOptions({
    queryKey: llmQueueKeys.list(org),
    queryFn: (): Promise<LlmQueue[]> => llmQueuesService.list(org),
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** A submitted review moves the queue's reviewed/pending split, which the list shows. */
export const submitQueueReviewMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { queueId: string; itemId: string; payload: any }) =>
      llmQueuesService.submitReview(org, vars.queueId, vars.itemId, vars.payload),
    // The workbench advances to the next item and toasts that itself.
    meta: { invalidates: [llmQueueKeys.all(org)], silentError: true },
  });

/** Distilling writes into a dataset, so it drops that scope rather than the queue's. */
export const pushQueueItemToDatasetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { queueId: string; itemId: string; payload: any }) =>
      llmQueuesService.pushToDataset(org, vars.queueId, vars.itemId, vars.payload),
    meta: { invalidates: [llmDatasetKeys.all(org)], silentError: true },
  });
