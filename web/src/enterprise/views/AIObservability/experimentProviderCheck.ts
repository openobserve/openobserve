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

// Create & run tests every LLM provider the run will call before it creates
// anything, with the same request Test Connection sends from provider
// settings. A run against an unreachable provider otherwise fails every slot.

import type { Provider, ProviderPayload, Scorer } from "@/services/online-evals.service";
import {
  availableModelsOf,
  defaultModelOf,
  entityId,
  providerTypeOf,
  scorerTypeOf,
} from "@/enterprise/components/onlineEvals/utils/evalEntity";

export interface RunProviderInput {
  taskType: string;
  providerId?: string | null;
  scorerIds: string[];
  scorers: Scorer[];
}

export interface ProviderCheckFailure {
  providerId: string;
  /** Provider name when known; the id otherwise. */
  providerName: string;
  /** Whether the provider is the task's own rather than a judge's. */
  task: boolean;
  /** Server reason, when it sent one. */
  message: string;
}

/** The provider ids the run calls: the task's own (inline or managed prompt;
 *  a Remote Task has its own connection test) and each selected LLM judge's.
 *  The task provider comes first so its failure is the one reported. */
export function runProviderIds(input: RunProviderInput): string[] {
  const ids: string[] = [];
  const add = (id: unknown) => {
    const value = typeof id === "string" ? id.trim() : "";
    if (value && !ids.includes(value)) ids.push(value);
  };
  if (input.taskType !== "remote") add(input.providerId);
  for (const id of input.scorerIds) {
    const scorer = input.scorers.find((candidate) => entityId(candidate) === id);
    if (!scorer || scorerTypeOf(scorer) !== "llm_judge") continue;
    add(scorer.params?.provider_id ?? scorer.params?.providerId);
  }
  return ids;
}

/** The stored provider as Test Connection would submit it. The blank API key
 *  makes the server use the stored secret for `providerId`. */
export function providerTestPayload(provider: Provider): ProviderPayload {
  return {
    name: provider.name,
    providerType: providerTypeOf(provider) ?? "",
    endpoint: provider.endpoint ?? null,
    defaultModel: defaultModelOf(provider) ?? "",
    availableModels: availableModelsOf(provider) ?? [],
    authConfig: { api_key: "" },
    isDefault: false,
  };
}

/** Tests every provider in `ids` in parallel and returns the first failure in
 *  `ids` order, or null when all answered. A provider missing from `providers`
 *  fails the check: the run could not call it either. */
export async function checkRunProviders(
  ids: string[],
  providers: Provider[],
  test: (payload: ProviderPayload, providerId: string) => Promise<unknown>,
  taskProviderId?: string | null,
): Promise<ProviderCheckFailure | null> {
  const results = await Promise.allSettled(
    ids.map((id) => {
      const provider = providers.find((candidate) => candidate.id === id);
      if (!provider) return Promise.reject(new Error(""));
      return test(providerTestPayload(provider), id);
    }),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const id = ids[index];
    return {
      providerId: id,
      providerName: providers.find((candidate) => candidate.id === id)?.name ?? id,
      task: id === taskProviderId,
      message: failureMessage(result.reason),
    };
  }
  return null;
}

/** The server's message from an Axios-style error, else the error's own. */
function failureMessage(reason: unknown): string {
  if (!reason || typeof reason !== "object") return "";
  if ("response" in reason) {
    const data = (reason.response as { data?: { message?: unknown } } | undefined)?.data;
    if (typeof data?.message === "string" && data.message) return data.message;
  }
  return reason instanceof Error ? reason.message : "";
}
