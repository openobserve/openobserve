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

import type { AgentSignalRecord } from "@/services/agent_signals";
import { UNSET } from "@/enterprise/composables/useAgentScope";

/**
 * Predicate: does signal `s` match the selected agent scope (name + env +
 * version)? `env`/`version` narrow the match ONLY when the selected variant
 * has them (null = don't constrain) — mirrors buildAgentTraceFilter's guards,
 * and keeps agents without env/version behaving exactly as before.
 *
 * Colocated here (rather than inline in AgentBehaviorPanel.vue's
 * `<script setup>`) so it can be unit tested directly without mounting the
 * panel's heavier deps (OTable, OStatStrip, i18n, vuex, http service) —
 * `<script setup>` cannot contain module exports.
 */
export const matchesAgentScope = (
  s: Pick<AgentSignalRecord, "agent_name" | "gen_ai_agent_env" | "gen_ai_agent_version">,
  scope: { name: string; env?: string | null; version?: string | null },
): boolean => {
  const env = scope.env ?? null;
  const ver = scope.version ?? null;
  return (
    (s.agent_name ?? "") === scope.name &&
    (env == null || (s.gen_ai_agent_env ?? null) === env) &&
    (ver == null || (s.gen_ai_agent_version ?? null) === ver)
  );
};

/**
 * The env/version a Behavior row's drill-down filters on. `null` leaves a
 * dimension open; UNSET pins it to "not set".
 */
export interface DrillScope {
  env: string | null;
  version: string | null;
}

interface LoopTotals {
  /** Row identity, for the table's row key and the selected-row highlight. */
  id: string;
  /** Display name; may be the "(unknown agent)" fallback. */
  agent: string;
  /** The real agent name the drill-down queries on; null when the rollup had none. */
  agentRaw: string | null;
  tool: string;
  calls: number;
  traces: number;
  ratio: number;
}

/** One env/version variant of a looping (agent, tool). */
export interface LoopVariantRow extends LoopTotals {
  env: string | null;
  version: string | null;
  /** Drill-down scope: exactly this variant. */
  scope: DrillScope;
}

/** One looping (agent, tool) over the whole range, across its variants. */
export interface LoopRow extends LoopTotals {
  /** Ranked by calls/trace; more than one makes the row expandable. */
  variants: LoopVariantRow[];
}

const ratioOf = (calls: number, traces: number): number =>
  traces > 0 ? Math.round((calls / traces) * 100) / 100 : 0;
const byRatio = (a: LoopTotals, b: LoopTotals) => b.ratio - a.ratio;

/**
 * Loop signals as one row per (agent, tool), ranked by calls/trace. The rollup
 * writes a record per hourly window, env and version, so calls and traces are
 * summed over the range and calls/trace is derived from the sums. Each row
 * keeps its env/version variants, summed the same way.
 */
export const buildLoopRows = (signals: AgentSignalRecord[], unknownAgent: string): LoopRow[] => {
  const groups = new Map<string, Map<string, LoopVariantRow>>();
  for (const s of signals) {
    if (s.signal_type !== "loop") continue;
    const agentRaw = s.agent_name ?? null;
    const tool = s.tool_name ?? "";
    const env = s.gen_ai_agent_env ?? null;
    const version = s.gen_ai_agent_version ?? null;
    const rowId = JSON.stringify([agentRaw, tool]);
    const variantId = JSON.stringify([agentRaw, tool, env, version]);
    let variants = groups.get(rowId);
    if (!variants) groups.set(rowId, (variants = new Map()));
    let v = variants.get(variantId);
    if (!v) {
      v = {
        id: variantId,
        agent: agentRaw ?? unknownAgent,
        agentRaw,
        tool,
        env,
        version,
        calls: 0,
        traces: 0,
        ratio: 0,
        scope: { env, version },
      };
      variants.set(variantId, v);
    }
    v.calls += s.calls ?? 0;
    v.traces += s.distinct_traces ?? 0;
  }
  return [...groups]
    .map(([id, byVariant]) => {
      const variants = [...byVariant.values()];
      // A variant without env or version is told apart from its siblings by
      // "not set", so that dimension is pinned. One all variants lack stays open:
      // the stream may not have the column at all.
      const varies = (key: "env" | "version") => new Set(variants.map((v) => v[key])).size > 1;
      const pinEnv = varies("env");
      const pinVersion = varies("version");
      for (const v of variants) {
        v.ratio = ratioOf(v.calls, v.traces);
        v.scope = {
          env: v.env ?? (pinEnv ? UNSET : null),
          version: v.version ?? (pinVersion ? UNSET : null),
        };
      }
      const calls = variants.reduce((sum, v) => sum + v.calls, 0);
      const traces = variants.reduce((sum, v) => sum + v.traces, 0);
      const { agent, agentRaw, tool } = variants[0];
      return {
        id,
        agent,
        agentRaw,
        tool,
        calls,
        traces,
        ratio: ratioOf(calls, traces),
        variants: variants.sort(byRatio),
      };
    })
    .sort(byRatio);
};

/** Distinct named agents among Behavior rows (the "(unknown agent)" rows excluded). */
export const countAgents = (rows: ReadonlyArray<{ agentRaw: string | null }>): number =>
  new Set(rows.map((r) => r.agentRaw).filter(Boolean)).size;
