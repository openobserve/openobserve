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

// Cost trust (unpriced / partial cost) and AI data health helpers shared by
// LLM Insights, Sessions and Traces. Ingest leaves `gen_ai_usage_cost` null and
// sets `gen_ai_usage_cost_status = 'unpriced'` when no price matches a model, and
// the trace/session APIs report those tokens as `gen_ai_unpriced_tokens`.

import type {
  DataHealthCheck,
  DataHealthCheckId,
  DataHealthModelUsage,
  DataHealthResponse,
} from "@/services/gen-ai-data-health.service";

/** How a row's cost reads: exact, a lower bound, or unknown. */
export type CostKind = "exact" | "partial" | "unknown";

export function costKind(cost: number, tokens: number, unpricedTokens: number): CostKind {
  if (!(unpricedTokens > 0)) return "exact";
  // Nothing priced: the recorded $0 is not a cost.
  if (!(cost > 0) || unpricedTokens >= tokens) return "unknown";
  return "partial";
}

/** Reads the per-row unpriced fields the trace / session APIs return (absent on older servers). */
export function unpricedFields(hit: {
  gen_ai_unpriced_tokens?: unknown;
  gen_ai_unpriced_models?: unknown;
}): { unpricedTokens: number; unpricedModels: string[] } {
  const raw = hit?.gen_ai_unpriced_models;
  const models = Array.isArray(raw)
    ? raw.filter((m): m is string => typeof m === "string" && m.length > 0)
    : [];
  return { unpricedTokens: Number(hit?.gen_ai_unpriced_tokens) || 0, unpricedModels: models };
}

export interface UnpricedTotals {
  /** Every distinct unpriced model; `models` lists at most 20 of them. */
  modelCount: number;
  /** Tokens on every unpriced span. */
  tokens: number;
  /** `models` holds only the models with the most tokens, not all `modelCount`. */
  truncated: boolean;
  models: DataHealthModelUsage[];
}

/** The unpriced check's uncapped totals from the server, not the length or sum of its list. */
export function unpricedTotals(check: DataHealthCheck): UnpricedTotals {
  const models = check.models ?? [];
  return {
    modelCount: check.model_count ?? models.length,
    tokens: check.unpriced_tokens ?? models.reduce((sum, m) => sum + (Number(m.tokens) || 0), 0),
    truncated: !!check.models_truncated,
    models,
  };
}

export interface UnpricedSummary extends UnpricedTotals {
  spans: number;
}

/** The unpriced-models check as a summary for the cost tile and charts; null when it passes. */
export function unpricedSummary(
  health: DataHealthResponse | null | undefined,
): UnpricedSummary | null {
  const check = health?.checks.find((c) => c.id === "unpriced_models");
  if (!check || check.affected <= 0) return null;
  return { ...unpricedTotals(check), spans: check.affected };
}

export interface HealthCounts {
  errors: number;
  warnings: number;
  passing: number;
}

export function healthCounts(checks: DataHealthCheck[]): HealthCounts {
  return checks.reduce<HealthCounts>(
    (acc, c) => {
      if (c.status === "error") acc.errors += 1;
      else if (c.status === "warning") acc.warnings += 1;
      else acc.passing += 1;
      return acc;
    },
    { errors: 0, warnings: 0, passing: 0 },
  );
}

/** Worst first (error, warning, pass), keeping the server order within a status. */
export function sortChecks(checks: DataHealthCheck[]): DataHealthCheck[] {
  const rank = { error: 0, warning: 1, pass: 2 } as const;
  return [...checks].sort((a, b) => rank[a.status] - rank[b.status]);
}

export const AI_INSTRUMENTATION_DOCS_URL = "https://openobserve.ai/docs/integration/ai/";

export type FixTarget =
  | { kind: "route"; to: { name: string; query: Record<string, string> } }
  | { kind: "url"; href: string };

/** Where each check is fixed: a setting when one exists, else the instrumentation docs. */
export function fixTarget(id: DataHealthCheckId, stream: string, orgId: string): FixTarget {
  switch (id) {
    case "unpriced_models":
      return {
        kind: "route",
        to: pricingGapsRoute(stream, orgId),
      };
    case "missing_agent_identity":
      return { kind: "route", to: { name: "genAiAgentMapping", query: { org_identifier: orgId } } };
    case "zero_duration_spans":
    case "missing_session_id":
      return { kind: "url", href: AI_INSTRUMENTATION_DOCS_URL };
  }
}

/** Route to Model Pricing's Pricing gaps page for `stream`. */
export function pricingGapsRoute(stream: string, orgId: string) {
  return {
    name: "modelPricingGaps",
    query: { stream, org_identifier: orgId },
  };
}
