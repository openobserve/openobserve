// Copyright 2026 OpenObserve Inc.
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { agentOptionKey, ALL_AGENTS_VALUE } from "./llmAgentFilter";

/** One-line label: `name (id) · env · vVERSION`, omitting absent segments. */
export function formatAgentOption(agent: GenAiAgentListItem): string {
  const base = agent.id ? `${agent.name} (${agent.id})` : agent.name;
  const parts = [base];
  if (agent.env) parts.push(agent.env);
  if (agent.version) parts.push(`v${agent.version}`);
  return parts.join(" · ");
}

/** Short label for a variant row under an agent header: `env · vVERSION`. */
function variantLabel(
  agent: GenAiAgentListItem,
  t: (k: string) => string,
): string {
  const parts: string[] = [];
  if (agent.env) parts.push(agent.env);
  if (agent.version) parts.push(`v${agent.version}`);
  return parts.length ? parts.join(" · ") : t("traces.agentDefaultVariant");
}

/**
 * Grouped option model: one non-selectable header per distinct agent name,
 * followed by its (env, version) variant rows. Each variant row carries the
 * full agent object so callers can filter by env/version downstream.
 */
export function buildAgentSelectOptions(
  agents: GenAiAgentListItem[],
  t: (k: string) => string,
  options: { includeAllAgents?: boolean } = {},
): SelectOption[] {
  const byName = new Map<string, GenAiAgentListItem[]>();
  for (const agent of agents) {
    const list = byName.get(agent.name) ?? [];
    list.push(agent);
    byName.set(agent.name, list);
  }
  const result: SelectOption[] = [];
  if (options.includeAllAgents) {
    result.push({ label: t("traces.allAgents"), value: ALL_AGENTS_VALUE });
  }
  for (const [name, variants] of byName) {
    result.push({ label: name, header: true });
    for (const agent of variants) {
      result.push({
        label: variantLabel(agent, t),
        value: agentOptionKey(agent),
        agent,
      });
    }
  }
  return result;
}

/**
 * Stream-picker options, each annotated with how many discovered agents the
 * stream contains — e.g. `sre_agent_traces_production (2 agents)`. The count is
 * shared across every AI page's Stream picker so they read identically. `value`
 * stays the bare stream name; the label carries the count.
 */
export function buildStreamSelectOptions(
  streams: string[],
  agents: GenAiAgentListItem[],
  t: (k: string) => string,
): SelectOption[] {
  const counts = new Map<string, number>();
  for (const a of agents) {
    counts.set(a.source_stream, (counts.get(a.source_stream) ?? 0) + 1);
  }
  return streams.map((s) => {
    const n = counts.get(s) ?? 0;
    const word =
      n === 1
        ? t("traces.agentCountSingular")
        : t("traces.agentCountPlural");
    return { label: `${s} (${n} ${word})`, value: s };
  });
}
