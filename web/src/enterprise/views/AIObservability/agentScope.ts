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
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { UNSET } from "@/enterprise/composables/useAgentScope";

/** Does signal `s` match the agent scope? null = unconstrained, UNSET = must have no value. */
export const matchesAgentScope = (
  s: Pick<AgentSignalRecord, "agent_name" | "gen_ai_agent_env" | "gen_ai_agent_version">,
  scope: { name: string; env?: string | null; version?: string | null },
): boolean => {
  const dim = (want: string | null | undefined, have: string | null | undefined) =>
    want == null || (want === UNSET ? !have : have === want);
  return (
    (s.agent_name ?? "") === scope.name &&
    dim(scope.env, s.gen_ai_agent_env) &&
    dim(scope.version, s.gen_ai_agent_version)
  );
};

/** Missing env/version becomes UNSET only when a sibling variant has one; else null, since the column may not exist. */
export const selectedAgentScope = (
  agent: GenAiAgentListItem | null | undefined,
  agents: ReadonlyArray<GenAiAgentListItem>,
): { name: string; env: string | null; version: string | null } | null => {
  if (!agent) return null;
  const siblings = agents.filter(
    (a) => a.name === agent.name && a.source_stream === agent.source_stream,
  );
  const pin = (value: string | null | undefined, key: "env" | "version") =>
    value || (siblings.some((a) => !!a[key]) ? UNSET : null);
  return { name: agent.name, env: pin(agent.env, "env"), version: pin(agent.version, "version") };
};

/** `null` leaves a dimension open; UNSET pins it to "not set". */
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

/** A dimension all variants lack stays open: the stream may not have the column. */
const pinVariantScopes = <
  V extends { env: string | null; version: string | null; scope: DrillScope },
>(
  variants: V[],
): V[] => {
  const varies = (key: "env" | "version") => new Set(variants.map((v) => v[key])).size > 1;
  const pinEnv = varies("env");
  const pinVersion = varies("version");
  for (const v of variants) {
    v.scope = {
      env: v.env ?? (pinEnv ? UNSET : null),
      version: v.version ?? (pinVersion ? UNSET : null),
    };
  }
  return variants;
};

/** The rollup writes per hour, env and version, so calls/trace is derived from summed counts. */
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
      const variants = pinVariantScopes([...byVariant.values()]);
      for (const v of variants) v.ratio = ratioOf(v.calls, v.traces);
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

interface FailureTotals {
  /** Row identity, for the table's row key and the selected-row highlight. */
  id: string;
  /** Display name; may be the "(unknown agent)" fallback. */
  agent: string;
  /** The real agent name the drill-down queries on; null when the rollup had none. */
  agentRaw: string | null;
  failClass: string;
  count: number;
}

/** One env/version variant of an agent's failure class. */
export interface FailureVariantRow extends FailureTotals {
  env: string | null;
  version: string | null;
  /** Drill-down scope: exactly this variant. */
  scope: DrillScope;
}

/** One failure class of an agent over the whole range, across its variants. */
export interface FailureRow extends FailureTotals {
  /** Most frequent first; more than one makes the row expandable. */
  variants: FailureVariantRow[];
}

const byCount = (a: FailureTotals, b: FailureTotals) => b.count - a.count;

export const buildFailureRows = (
  signals: AgentSignalRecord[],
  unknownAgent: string,
): FailureRow[] => {
  const groups = new Map<string, Map<string, FailureVariantRow>>();
  for (const s of signals) {
    if (s.signal_type !== "failure") continue;
    const agentRaw = s.agent_name ?? null;
    const failClass = s.fail_class ?? "unclassified";
    const env = s.gen_ai_agent_env ?? null;
    const version = s.gen_ai_agent_version ?? null;
    const rowId = JSON.stringify([agentRaw, failClass]);
    const variantId = JSON.stringify([agentRaw, failClass, env, version]);
    let variants = groups.get(rowId);
    if (!variants) groups.set(rowId, (variants = new Map()));
    let v = variants.get(variantId);
    if (!v) {
      v = {
        id: variantId,
        agent: agentRaw ?? unknownAgent,
        agentRaw,
        failClass,
        env,
        version,
        count: 0,
        scope: { env, version },
      };
      variants.set(variantId, v);
    }
    v.count += s.count ?? 0;
  }
  return [...groups]
    .map(([id, byVariant]) => {
      const variants = pinVariantScopes([...byVariant.values()]);
      const { agent, agentRaw, failClass } = variants[0];
      return {
        id,
        agent,
        agentRaw,
        failClass,
        count: variants.reduce((sum, v) => sum + v.count, 0),
        variants: variants.sort(byCount),
      };
    })
    .sort(byCount);
};

/** Distinct named agents among Behavior rows (the "(unknown agent)" rows excluded). */
export const countAgents = (rows: ReadonlyArray<{ agentRaw: string | null }>): number =>
  new Set(rows.map((r) => r.agentRaw).filter(Boolean)).size;
