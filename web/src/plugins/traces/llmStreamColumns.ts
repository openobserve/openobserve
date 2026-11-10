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

import { queryClient } from "@/composables/query/queryClient";
import { streamSchemaQuery } from "@/services/stream.queries";
import { PARENT_SPAN_FIELD } from "./config/llmInsightsPanels";

/**
 * Whether a trace stream stores span parents, which `agentParentsJoin` needs
 * to tell top-level agents from nested ones. Reads the cached schema. A schema
 * that can't be read counts as having none: the usage queries still run, they
 * only lose the nested-agent check.
 */
export async function streamHasParentSpan(org: string, stream: string): Promise<boolean> {
  try {
    const payload = await queryClient.fetchQuery(streamSchemaQuery(org, stream, "traces"));
    const fields: Array<{ name?: string }> = payload?.schema ?? payload?.fields ?? [];
    return fields.some((f) => f?.name === PARENT_SPAN_FIELD);
  } catch {
    return false;
  }
}
