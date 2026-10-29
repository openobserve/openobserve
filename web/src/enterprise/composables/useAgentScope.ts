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

import { raw } from "@/types/i18n";

import { computed, ref, watch } from "vue";
import { isAxiosError } from "axios";
import type { LocationQuery, LocationQueryRaw } from "vue-router";
import type { ComputedRef, Ref } from "vue";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { genAiAgentsQuery } from "@/services/gen-ai-agent-mapping.queries";
import { queryClient, quantizeRange } from "@/composables/query/queryClient";
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

export type ScopeMode = "stream" | "agent";

/**
 * The Stream/Agent choice a user made with the toggle, shared by the four
 * Monitor pages (Insights, Sessions, Agent Graph, Agent Behavior). Written only
 * by the toggle, never by a page load, so an absent key means "never chose" and
 * the page picks its mode from the agents list instead.
 */
export const SCOPE_MODE_CHOICE_LS_KEY = "aiObservability_scopeModeChoice";

/** Scope carried in a Monitor page URL: `?type=&stream=&agent=&env=&version=`. */
export interface UrlScope {
  type: ScopeMode | null;
  stream: string;
  agent: string;
  env: string;
  version: string;
}

export function readUrlScope(query: LocationQuery): UrlScope {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const type = str(query.type);
  return {
    type: type === "stream" || type === "agent" ? type : null,
    stream: str(query.stream),
    agent: str(query.agent),
    env: str(query.env),
    version: str(query.version),
  };
}

export function rememberModeChoice(mode: ScopeMode): void {
  localStorage.setItem(SCOPE_MODE_CHOICE_LS_KEY, mode);
}

/**
 * The mode the user asked for, or null when the agents list should decide: the
 * URL `type` (any agent/env/version scope also means Agent), else the remembered
 * toggle choice.
 */
export function explicitScopeMode(url: UrlScope): ScopeMode | null {
  if (url.type) return url.type;
  if (url.agent || url.env || url.version) return "agent";
  const remembered = localStorage.getItem(SCOPE_MODE_CHOICE_LS_KEY);
  return remembered === "stream" || remembered === "agent" ? remembered : null;
}

/** Why the last agents load failed: a 403 (`forbidden`) or any other error (`failed`). */
export type AgentsLoadError = "forbidden" | "failed";

/**
 * Final mode for a page: an explicit choice wins; otherwise Agent when the
 * window has agents and Stream when it has none, so LLM data without agent
 * identity still opens on something to look at. A failed agents load says
 * nothing about agent identity, so it never picks Stream: the page stays on
 * Agent, where the load error and its retry show. Pages re-decide after a
 * load that succeeds.
 */
export function resolveScopeMode(
  explicit: ScopeMode | null,
  agentCount: number,
  agentsError: AgentsLoadError | null = null,
): ScopeMode {
  if (explicit) return explicit;
  if (agentsError) return "agent";
  return agentCount > 0 ? "agent" : "stream";
}

/**
 * The page query with the scope written in. `type` and the agent
 * (`agent`/`env`/`version`) are written only when the scope was explicit (URL,
 * toggle or agent pick): an auto-picked scope left in the URL would read as a
 * choice on reload and stop the page from re-deciding once agents change.
 */
export function scopeUrlQuery(
  current: LocationQuery,
  scope: {
    mode: ScopeMode;
    explicit: boolean;
    stream: string;
    agent?: { name: string; env: string; version: string } | null;
  },
): LocationQueryRaw {
  const query: LocationQueryRaw = { ...current };
  if (scope.explicit) query.type = scope.mode;
  else delete query.type;
  delete query.agent;
  delete query.env;
  delete query.version;
  delete query.stream;
  if (scope.mode === "agent") {
    if (scope.explicit && scope.agent?.name) {
      query.agent = scope.agent.name;
      query.env = scope.agent.env;
      query.version = scope.agent.version;
    }
  } else if (scope.stream) {
    query.stream = scope.stream;
  }
  return query;
}

/** Stream-scoped identity of a resolved agent ("" for none) — what a page reloads on. */
export function agentIdentityKey(a: GenAiAgentListItem | null): string {
  return a ? `${a.source_stream}::${a.name}::${a.env ?? ""}::${a.version ?? ""}` : "";
}

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
  /** Cascade only (Quality): each level offers and starts on "All"; the unset buckets are left out, as exact-match APIs cannot filter on them. */
  allOption?: boolean;
  /** Module-scoped agents ref (Sessions/LLM) or created locally (Graph/Behavior). */
  agents?: Ref<GenAiAgentListItem[]>;
  /** Module-scoped agentsLoaded ref, created locally when omitted. */
  agentsLoaded?: Ref<boolean>;
  /** Module-scoped agents load error ref, created locally when omitted. */
  agentsError?: Ref<AgentsLoadError | null>;
  /**
   * The single selection ref. When provided (Sessions injects its
   * localStorage-initialized ref), it is used as-is so the page owns
   * initialization/persistence; otherwise a local ref is created seeded from
   * `allAgents` (ALL_AGENTS_VALUE sentinel or "").
   */
  activeAgent?: Ref<string>;
  /** Optional SQL predicate builder (buildAgentTraceFilter / buildAgentSessionFilter / name). */
  filterBuilder?: (agent: GenAiAgentListItem | null, stream: string) => string;
  t: (k: string) => string;
}

export interface UseAgentScopeReturn {
  agents: Ref<GenAiAgentListItem[]>;
  agentsLoaded: Ref<boolean>;
  /**
   * Why the last agents load failed, or null after a load that succeeded. A
   * failed load leaves `agents` empty but is not "no agents": `agentEmpty` and
   * `noAgentIdentity` stay false and the page shows the error with a retry.
   */
  agentsError: Ref<AgentsLoadError | null>;
  /** Agent mode and the last agents load failed. */
  agentsLoadFailed: ComputedRef<boolean>;
  /** Loads the agents for the window; `force` (a user refresh) bypasses the query cache. */
  loadAgents: (start?: number, end?: number, force?: boolean) => Promise<void>;
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
  /** Stream mode, agents loaded and none found while an LLM stream exists. */
  noAgentIdentity: ComputedRef<boolean>;
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
  /**
   * Seed the cascade from an (env, name, version) scope — a URL deep-link or a
   * persisted selection. Any of the three may be "" (not given). Picks the agent
   * matching every given dimension, else drops version, else matches the name
   * alone, so a same-named agent under a different env/version is only the
   * fallback. Returns true when an agent was selected.
   */
  selectAgentByScope: (env: string, name: string, version: string) => boolean;
}

export function useAgentScope(opts: UseAgentScopeOptions): UseAgentScopeReturn {
  const allAgents = opts.allAgents ?? false;

  // Hazard 2 — module-scoped agents: use the injected refs when provided
  // (Sessions/LLM keep their module singletons so the picker survives remount);
  // otherwise create local refs (Graph/Behavior). `loadAgents` writes into
  // whichever pair is in play.
  const agents = opts.agents ?? ref<GenAiAgentListItem[]>([]);
  const agentsLoaded = opts.agentsLoaded ?? ref(false);
  const agentsError = opts.agentsError ?? ref<AgentsLoadError | null>(null);
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
        label: raw(v === UNSET ? (unsetLabel ?? v) : v),
        value: v,
      });
    }
    return out;
  }

  const allOption = cascade && (opts.allOption ?? false);
  // With allOption, an "All" level matches every agent and the unset bucket is not offered.
  const levelMatches = (selected: string, value: string) =>
    (allOption && selected === ALL_AGENTS_VALUE) || selected === value;
  const withAll = (options: SelectOption[], allKey: string): SelectOption[] =>
    allOption
      ? [
          { label: raw(opts.t(allKey)), value: ALL_AGENTS_VALUE },
          ...options.filter((o) => o.value !== UNSET),
        ]
      : options;

  const envs = computed<SelectOption[]>(() =>
    cascade
      ? withAll(
          distinctOptions(agents.value.map(agentEnv), opts.t("traces.agentNoEnv")),
          "common.all",
        )
      : [],
  );

  // Each name option carries the agent ids behind it (`agentIds`, shown on hover
  // by AgentScopeCascade and under the name in the list) so a name never hides
  // which registered agent it is, and an id typed in the search still finds it.
  const agentNames = computed<SelectOption[]>(() => {
    if (!cascade) return [];
    const inEnv = agents.value.filter((a) => levelMatches(selectedEnv.value, agentEnv(a)));
    const idsByName = new Map<string, string[]>();
    for (const a of inEnv) {
      if (!a.id || a.id === a.name) continue;
      const ids = idsByName.get(a.name) ?? [];
      if (!ids.includes(a.id)) ids.push(a.id);
      idsByName.set(a.name, ids);
    }
    const options = distinctOptions(inEnv.map((a) => a.name)).map((o) => {
      const ids = idsByName.get(o.value as string);
      return ids ? { ...o, agentIds: ids, subLabel: ids.join(", "), searchText: ids.join(" ") } : o;
    });
    return withAll(options, "traces.allAgents");
  });

  const versions = computed<SelectOption[]>(() =>
    cascade
      ? withAll(
          distinctOptions(
            agents.value
              .filter(
                (a) =>
                  levelMatches(selectedEnv.value, agentEnv(a)) &&
                  levelMatches(selectedAgentName.value, a.name),
              )
              .map(agentVersion),
            opts.t("traces.agentNoVersion"),
          ),
          "common.all",
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
    watch([agents, selectedEnv, selectedAgentName, selectedVersion], reconcile, {
      immediate: true,
      flush: "sync",
    });
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

  // Any of the three may be "" (not given, e.g. an `?env=production` link with no
  // agent). Tries the exact given dimensions first, then drops version, then
  // keeps only the name, so a link whose version or env is gone for this window
  // still lands on the named agent rather than on the first one in the list.
  function selectAgentByScope(env: string, name: string, version: string): boolean {
    if (!cascade || (!env && !name && !version)) return false;
    const envOk = (a: GenAiAgentListItem) => !env || agentEnv(a) === env;
    const nameOk = (a: GenAiAgentListItem) => !name || a.name === name;
    const match =
      agents.value.find(
        (a) => envOk(a) && nameOk(a) && (!version || agentVersion(a) === version),
      ) ??
      agents.value.find((a) => envOk(a) && nameOk(a)) ??
      (name ? agents.value.find((a) => a.name === name) : undefined);
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
      streamSelectOptions.value.find((o) => o.value === opts.activeStream.value)?.agentCount ?? 0,
  );

  const selectedAgent = computed<GenAiAgentListItem | null>(() => {
    // Cascade mode: resolve the concrete agent from env + name + version
    // (all three must be pinned to a real, unset-aware value).
    if (cascade) {
      if (!selectedEnv.value || !selectedAgentName.value || !selectedVersion.value) {
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
    return agents.value.find((a) => agentOptionKey(a) === activeAgent.value) ?? null;
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
    opts.filterBuilder ? opts.filterBuilder(effectiveAgent.value, effectiveStream.value) : "",
  );

  const agentEmpty = computed(
    () =>
      opts.filterMode.value === "agent" &&
      agentsLoaded.value &&
      !agentsError.value &&
      agents.value.length === 0,
  );

  const agentsLoadFailed = computed(
    () => opts.filterMode.value === "agent" && agentsError.value !== null,
  );

  // Stream mode on an org whose LLM streams carry no agent identity: the page
  // shows the "No agent identity found" banner pointing at GenAI Agent Mapping.
  // A failed agents load proves nothing about identity, so it never shows it.
  const noAgentIdentity = computed(
    () =>
      opts.filterMode.value === "stream" &&
      agentsLoaded.value &&
      !agentsError.value &&
      agents.value.length === 0 &&
      availableStreams.value.length > 0,
  );

  // The one agents loader for every Monitor page. Calls for the same org and
  // minute bucket (the query key's own quantization) while a request is in
  // flight join it, so the several callers on page entry (date replay, mode
  // resolution) cost one request. A forced refresh waits for any request for
  // the same key, then invalidates and fetches again rather than reusing it.
  let inFlight: { key: string; promise: Promise<void> } | null = null;
  let requestSequence = 0;
  async function loadAgents(start?: number, end?: number, force = false): Promise<void> {
    const org = opts.orgId();
    const win = opts.getWindow();
    const startTime = start ?? win.start;
    const endTime = end ?? win.end;
    if (!org || !startTime || !endTime) return;
    const bucket = quantizeRange(startTime, endTime);
    const key = `${org}::${bucket.start}-${bucket.end}`;
    const previous = inFlight?.key === key ? inFlight.promise : null;
    if (!force && previous) return previous;
    const sequence = ++requestSequence;
    // Only the latest window/org request owns the visible list and load state.
    const superseded = () => sequence !== requestSequence || opts.orgId() !== org;
    const promise = (async () => {
      try {
        if (force && previous) await previous;
        const options = genAiAgentsQuery(org, startTime, endTime);
        if (force) {
          await queryClient.invalidateQueries({
            queryKey: options.queryKey,
            exact: true,
            refetchType: "none",
          });
        }
        const res = await queryClient.fetchQuery(options);
        if (superseded()) return;
        agents.value = res.agents ?? [];
        agentsError.value = null;
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
        if (superseded()) return;
        console.warn("Failed to load GenAI agents", e);
        agents.value = [];
        agentsError.value = isAxiosError(e) && e.response?.status === 403 ? "forbidden" : "failed";
        if (allAgents) activeAgent.value = ALL_AGENTS_VALUE;
      } finally {
        if (!superseded()) agentsLoaded.value = true;
      }
    })().finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { key, promise };
    return promise;
  }

  return {
    agents,
    agentsLoaded,
    agentsError,
    agentsLoadFailed,
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
    noAgentIdentity,
    envs,
    agentNames,
    versions,
    selectedEnv,
    selectedAgentName,
    selectedVersion,
    selectAgentByName,
    selectAgentByScope,
  };
}
