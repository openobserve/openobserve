// Copyright 2026 OpenObserve Inc.
//
// useAgentScope — the single composable owning agent loading, selection,
// grouped-dropdown options, and stream/agent resolution across all 4 AI pages
// (Sessions, LLM Insights, Agent Graph, Agent Behavior).
//
// This composable reproduces TODAY'S single grouped-dropdown behavior EXACTLY.
// It intentionally does NOT implement the Env→Agent→Version cascade (Plan 2);
// selection is a single dropdown whose value is either the All-Agents sentinel
// or a per-variant agentOptionKey.
//
// The 4 pages fall into TWO shapes, both served here via `allAgents`:
//   • allAgents:true  (Sessions / LLM) — default selection is ALL_AGENTS_VALUE,
//     the option list includes an "All Agents" entry, and selecting it yields a
//     null agent (no filter). Sessions/LLM own their `agents`/`agentsLoaded`
//     refs MODULE-SCOPED (survive remount), so they are injected here.
//   • allAgents:false (Graph / Behavior) — no All-Agents entry; the first agent
//     is auto-selected on load. These pages don't inject refs, so we create
//     local ones.
//
// The one intentional behavior normalization: `effectiveStream` uses `?? ""`
// uniformly. Behavior previously used `?? activeStream.value`, but with a
// first-agent default the selected agent's `source_stream` is non-empty, so the
// fallback is never observably reached (covered by an equivalence test).

import { computed, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import {
  buildAgentSelectOptions,
  buildStreamSelectOptions,
} from "@/plugins/traces/agentOptionFormat";
import { agentOptionKey, ALL_AGENTS_VALUE } from "@/plugins/traces/llmAgentFilter";

/**
 * Sentinel value used by the Env→Agent→Version cascade to represent an agent
 * whose `env` or `version` is null/absent. Distinct from "" so a genuinely
 * empty selection and an explicit "unset" dimension never collide. Mapped back
 * to `null` when resolving the concrete agent.
 */
export const UNSET = "__unset__";

/** Cascade env of an agent: its `env`, or the UNSET sentinel when null/absent. */
function agentEnv(a: GenAiAgentListItem): string {
  return a.env ?? UNSET;
}

/** Cascade version of an agent: its `version`, or UNSET when null/absent. */
function agentVersion(a: GenAiAgentListItem): string {
  return a.version ?? UNSET;
}

export interface UseAgentScopeOptions {
  /** Current filter mode toggle (owned by the page). */
  filterMode: Ref<"stream" | "agent">;
  /** The page-picked stream (Stream mode; also the agent-mode fallback source). */
  activeStream: Ref<string>;
  /** Streams available for the Stream picker (injected or created locally). */
  availableStreams?: Ref<string[]>;
  /** Resolves the current org identifier (page owns the store). */
  orgId: () => string | undefined;
  /** Supplies the query window; page owns its date/time range. */
  getWindow: () => { start?: number; end?: number };
  /** Sessions/LLM pass true → All-Agents sentinel + include the option. */
  allAgents?: boolean;
  /**
   * Opt into the Env→Agent→Version cascade (Plan 2). When true, the cascade
   * refs (selectedEnv/AgentName/Version) drive `selectedAgent` instead of the
   * single `activeAgent` dropdown, and the derived option lists (envs /
   * agentNames / versions) are populated + kept consistent (auto-select single,
   * reset lower on higher change). Defaults to false so today's single-dropdown
   * behavior is unchanged.
   */
  cascade?: boolean;
  /**
   * Version-agnostic cascade (Agent Graph). When true, the reconciler
   * auto-selects the FIRST version (not only singletons) so `selectedAgent`
   * always resolves from env + name even when several versions exist. The Graph
   * page hides the Version dropdown (topology is the same across versions), so
   * an un-pickable version must never leave the selection empty. Only meaningful
   * with `cascade:true`; defaults to false so the version-aware pages keep
   * requiring an explicit version pick.
   */
  versionAgnostic?: boolean;
  /** Module-scoped agents ref (Sessions/LLM) or created locally (Graph/Behavior). */
  agents?: Ref<GenAiAgentListItem[]>;
  /** Module-scoped agentsLoaded ref, created locally when omitted. */
  agentsLoaded?: Ref<boolean>;
  /**
   * The single selection ref. When provided (Sessions injects its
   * localStorage-initialized ref), it is used as-is so the page owns
   * initialization/persistence; otherwise a local ref is created seeded from
   * `allAgents` (ALL_AGENTS_VALUE sentinel or "").
   */
  activeAgent?: Ref<string>;
  /** Optional SQL predicate builder (buildAgentTraceFilter / buildAgentSessionFilter / name). */
  filterBuilder?: (
    agent: GenAiAgentListItem | null,
    stream: string,
  ) => string;
  t: (k: string) => string;
}

export interface UseAgentScopeReturn {
  agents: Ref<GenAiAgentListItem[]>;
  agentsLoaded: Ref<boolean>;
  loadAgents: (start?: number, end?: number) => Promise<void>;
  /** The single selection ref. All-Agents shape defaults to ALL_AGENTS_VALUE. */
  activeAgent: Ref<string>;
  agentSelectOptions: ComputedRef<SelectOption[]>;
  streamSelectOptions: ComputedRef<(SelectOption & { agentCount: number })[]>;
  selectedStreamCount: ComputedRef<number>;
  selectedAgent: ComputedRef<GenAiAgentListItem | null>;
  effectiveStream: ComputedRef<string>;
  effectiveAgent: ComputedRef<GenAiAgentListItem | null>;
  agentFilterClause: ComputedRef<string>;
  agentEmpty: ComputedRef<boolean>;
  // ── Env→Agent→Version cascade (Plan 2) ──────────────────────────────────
  /** Distinct env options across all agents (null → UNSET), in first-seen order. */
  envs: ComputedRef<SelectOption[]>;
  /** Distinct agent-name options within `selectedEnv`. */
  agentNames: ComputedRef<SelectOption[]>;
  /** Distinct version options within `selectedEnv` + `selectedAgentName`. */
  versions: ComputedRef<SelectOption[]>;
  /** Selected env (or UNSET). Empty string = nothing selected yet. */
  selectedEnv: Ref<string>;
  /** Selected agent name (scoped to `selectedEnv`). */
  selectedAgentName: Ref<string>;
  /** Selected version (or UNSET, scoped to env + name). */
  selectedVersion: Ref<string>;
  /**
   * Seed the cascade selection from an agent NAME (the URL `?agent=` deep-link
   * and localStorage-restore path). Picks the FIRST agent with that name and
   * pins env → name → version (UNSET-aware) so `selectedAgent` resolves. Returns
   * true when an agent matched (so callers can fall back to a default otherwise).
   * No-op — returns false — outside cascade mode or when no agent matches.
   */
  selectAgentByName: (name: string) => boolean;
}

export function useAgentScope(
  opts: UseAgentScopeOptions,
): UseAgentScopeReturn {
  const allAgents = opts.allAgents ?? false;

  // Hazard 2 — module-scoped agents: use the injected refs when provided
  // (Sessions/LLM keep their module singletons so the picker survives remount);
  // otherwise create local refs (Graph/Behavior). `loadAgents` writes into
  // whichever pair is in play.
  const agents = opts.agents ?? ref<GenAiAgentListItem[]>([]);
  const agentsLoaded = opts.agentsLoaded ?? ref(false);
  const availableStreams = opts.availableStreams ?? ref<string[]>([]);

  // Hazard 1 — sentinel split: the All-Agents shape starts on the sentinel;
  // the first-agent shape starts empty and defaults to the first agent on load.
  // When the page injects its own selection ref (Sessions' localStorage-init'd
  // ref), use it as-is so page-owned initialization/persistence is preserved.
  const activeAgent = opts.activeAgent ?? ref<string>(allAgents ? ALL_AGENTS_VALUE : "");

  // ── Env→Agent→Version cascade (Plan 2) ────────────────────────────────────
  // Additive: when `cascade` is off, the derived lists stay empty and none of
  // this touches the single-dropdown path. When on, these three refs drive
  // `selectedAgent` (see below), and a watch keeps them mutually consistent:
  // a dimension with exactly one value auto-selects, and changing any level
  // (or agents reloading) re-derives every level beneath it.
  const cascade = opts.cascade ?? false;
  const versionAgnostic = opts.versionAgnostic ?? false;
  const selectedEnv = ref<string>("");
  const selectedAgentName = ref<string>("");
  const selectedVersion = ref<string>("");

  // distinct-in-first-seen-order helper producing SelectOption[]. The UNSET
  // sentinel (agent has no value for this dimension) is rendered as a bucket
  // OPTION that coexists with the real values — "(No env)" on Env, "(No
  // version)" on Version — so the untagged agents stay selectable alongside
  // e.g. "production". This is distinct from the whole dropdown being empty
  // (that is OSelect's own "No options found") and from there being no agents
  // at all (the page hides the cascade and shows its own empty state).
  // agentNames never contains UNSET (a name is always present), so it passes no
  // unset label.
  function distinctOptions(values: string[], unsetLabel?: string): SelectOption[] {
    const seen = new Set<string>();
    const out: SelectOption[] = [];
    for (const v of values) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push({
        label: v === UNSET ? unsetLabel ?? v : v,
        value: v,
      });
    }
    return out;
  }

  const envs = computed<SelectOption[]>(() =>
    cascade
      ? distinctOptions(
          agents.value.map(agentEnv),
          opts.t("traces.agentNoEnv"),
        )
      : [],
  );

  const agentNames = computed<SelectOption[]>(() =>
    cascade
      ? distinctOptions(
          agents.value
            .filter((a) => agentEnv(a) === selectedEnv.value)
            .map((a) => a.name),
        )
      : [],
  );

  const versions = computed<SelectOption[]>(() =>
    cascade
      ? distinctOptions(
          agents.value
            .filter(
              (a) =>
                agentEnv(a) === selectedEnv.value &&
                a.name === selectedAgentName.value,
            )
            .map(agentVersion),
          opts.t("traces.agentNoVersion"),
        )
      : [],
  );

  // Keep each cascade level valid + auto-select a sensible default. Runs top-down
  // so clearing/auto-selecting a higher level re-derives the ones below within
  // the same reactive flush. `{ immediate: true }` seeds the initial selection.
  //
  // Default-to-FIRST (not only singletons): every AI page must open in a
  // "default selected" state — first env → first agent → first version — so the
  // page shows data immediately instead of an empty cascade + no results / an
  // endless graph spinner. This matches the pre-cascade single-dropdown, which
  // auto-selected the first agent on load. The user changes it from there; the
  // reset-lower-on-higher-change logic below still holds because an invalid
  // (out-of-set) selection re-defaults to the new level's first option.
  if (cascade) {
    const reconcile = () => {
      const envVals = envs.value.map((o) => o.value as string);
      if (!envVals.includes(selectedEnv.value)) {
        selectedEnv.value = envVals.length ? envVals[0] : "";
      }
      const nameVals = agentNames.value.map((o) => o.value as string);
      if (!nameVals.includes(selectedAgentName.value)) {
        selectedAgentName.value = nameVals.length ? nameVals[0] : "";
      }
      const verVals = versions.value.map((o) => o.value as string);
      if (!verVals.includes(selectedVersion.value)) {
        selectedVersion.value = verVals.length ? verVals[0] : "";
      }
    };
    // `flush: 'sync'` so a caller that sets a higher level and immediately reads
    // the re-derived lower levels (the common imperative usage) sees a
    // consistent cascade without awaiting a tick.
    watch(
      [agents, selectedEnv, selectedAgentName, selectedVersion],
      reconcile,
      { immediate: true, flush: "sync" },
    );
  }

  // Seed the cascade from an agent name (URL deep-link / persistence restore).
  // Sets env → name → version from the first matching agent so `selectedAgent`
  // resolves; the reconciler then keeps the lower lists consistent. Returns
  // whether a match was found.
  function selectAgentByName(name: string): boolean {
    if (!cascade || !name) return false;
    const match = agents.value.find((a) => a.name === name);
    if (!match) return false;
    selectedEnv.value = agentEnv(match);
    selectedAgentName.value = match.name;
    selectedVersion.value = agentVersion(match);
    return true;
  }

  const agentSelectOptions = computed(() =>
    buildAgentSelectOptions(agents.value, opts.t, {
      includeAllAgents: allAgents,
    }),
  );

  const streamSelectOptions = computed(() =>
    buildStreamSelectOptions(availableStreams.value, agents.value),
  );

  const selectedStreamCount = computed(
    () =>
      streamSelectOptions.value.find(
        (o) => o.value === opts.activeStream.value,
      )?.agentCount ?? 0,
  );

  const selectedAgent = computed<GenAiAgentListItem | null>(() => {
    // Cascade mode: resolve the concrete agent from env + name + version
    // (all three must be pinned to a real, unset-aware value).
    if (cascade) {
      if (
        !selectedEnv.value ||
        !selectedAgentName.value ||
        !selectedVersion.value
      ) {
        return null;
      }
      return (
        agents.value.find(
          (a) =>
            agentEnv(a) === selectedEnv.value &&
            a.name === selectedAgentName.value &&
            agentVersion(a) === selectedVersion.value,
        ) ?? null
      );
    }
    // Single-dropdown mode (unchanged).
    if (allAgents && activeAgent.value === ALL_AGENTS_VALUE) return null;
    return (
      agents.value.find((a) => agentOptionKey(a) === activeAgent.value) ?? null
    );
  });

  // Hazard 3 — effectiveStream normalization: uniformly `?? ""`. In agent mode
  // the selected agent's source_stream drives the query; with no agent it is "".
  // Stream mode reads the page-picked stream.
  const effectiveStream = computed(() =>
    opts.filterMode.value === "agent"
      ? (selectedAgent.value?.source_stream ?? "")
      : opts.activeStream.value,
  );

  const effectiveAgent = computed<GenAiAgentListItem | null>(() =>
    opts.filterMode.value === "agent" ? selectedAgent.value : null,
  );

  const agentFilterClause = computed(() =>
    opts.filterBuilder
      ? opts.filterBuilder(effectiveAgent.value, effectiveStream.value)
      : "",
  );

  const agentEmpty = computed(
    () =>
      opts.filterMode.value === "agent" &&
      agentsLoaded.value &&
      agents.value.length === 0,
  );

  async function loadAgents(start?: number, end?: number): Promise<void> {
    const org = opts.orgId();
    const win = opts.getWindow();
    const startTime = start ?? win.start;
    const endTime = end ?? win.end;
    if (!org || !startTime || !endTime) return;
    agentsLoaded.value = false;
    try {
      const res = await genAiAgentMappingService.listAgents(
        org,
        startTime,
        endTime,
      );
      agents.value = res.agents ?? [];
      if (allAgents) {
        // Sentinel shape: keep All-Agents; only clamp a now-invalid selection.
        if (
          activeAgent.value !== ALL_AGENTS_VALUE &&
          !agents.value.some((a) => agentOptionKey(a) === activeAgent.value)
        ) {
          activeAgent.value = ALL_AGENTS_VALUE;
        }
      } else if (!activeAgent.value && agents.value.length) {
        // First-agent shape: default to the first agent when nothing selected.
        activeAgent.value = agentOptionKey(agents.value[0]);
      }
    } catch (e) {
      console.warn("Failed to load GenAI agents", e);
      agents.value = [];
      if (allAgents) activeAgent.value = ALL_AGENTS_VALUE;
    } finally {
      agentsLoaded.value = true;
    }
  }

  return {
    agents,
    agentsLoaded,
    loadAgents,
    activeAgent,
    agentSelectOptions,
    streamSelectOptions,
    selectedStreamCount,
    selectedAgent,
    effectiveStream,
    effectiveAgent,
    agentFilterClause,
    agentEmpty,
    envs,
    agentNames,
    versions,
    selectedEnv,
    selectedAgentName,
    selectedVersion,
    selectAgentByName,
  };
}
