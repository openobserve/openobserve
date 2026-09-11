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

// The curated engine's orchestration layer (design §5.1-§5.6): tiered fetches, the probe ladder, generations.

import {
  computed,
  ref,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import type { FieldAlias } from "@/services/service_streams";
import useStreams from "@/composables/useStreams";
import searchService from "@/services/search";
import { loadSemanticGroups, clearSemanticGroupsCacheForOrg } from "@/utils/semanticGroupsCache";
import { workloadStateFromNames, type WorkloadState } from "@/composables/useWorkloadDetection";
import { gt, raw } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { colorToRgba } from "@/utils/dashboard/colorPalette";
import {
  buildDashboard,
  resolveManifest,
  type CuratedResolution,
  type CuratedWarning,
  type HiddenGroupInfo,
  type PartialGroupInfo,
  type PickerOption,
  type ProbeVerdict,
  type StaleGroupInfo,
  type StreamListEntry,
} from "./resolve";
import {
  STALENESS_24H_US,
  type CuratedPageManifest,
  type CuratedPagePins,
  type CuratedStreamType,
} from "./types";

/** Client budget for the whole probe fan-out — the face is never blocked past it. */
export const PROBE_TIMEOUT_MS = 4000;

const BUCKET_US = 5 * 60 * 1_000_000;

/** Matches the probe cache's bucket so both warm tiers expire together; `force` bypasses it. */
const SCHEMA_TTL_MS = 5 * 60 * 1000;

// MODULE scope so a revisit reuses the reads instead of re-firing them; keyed by ORG+TYPE+NAME so no org is served another's schema.
const schemaReads = new Map<string, { at: number; read: Promise<StreamListEntry | undefined> }>();

const schemaKey = (orgId: string, type: string, name: string) => `${orgId}:${type}:${name}`;

/** Held as a PROMISE so concurrent walks share one in-flight read. */
const cachedSchemaRead = (key: string): Promise<StreamListEntry | undefined> | undefined => {
  const hit = schemaReads.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > SCHEMA_TTL_MS) {
    schemaReads.delete(key);
    return undefined;
  }
  return hit.read;
};

/** Drop one org's reads only — another org's cache is unrelated state. */
const clearSchemaReadsForOrg = (orgId: string) => {
  for (const key of [...schemaReads.keys()]) {
    if (key.startsWith(`${orgId}:`)) schemaReads.delete(key);
  }
};

/** The cache outlives every mount, so a test that counts schema reads must start from empty. */
export const __resetSchemaReadsForTest = () => schemaReads.clear();

/** `${theme:NAME}` → an EXISTING design token (+ optional alpha), the sandbox's only route to a themed colour. */
const CHART_THEME_TOKENS: Record<string, { token: `--${string}`; alpha?: number }> = {
  // The four status ramps are theme-independent by design, so one value reads on both surfaces.
  "chart-healthy": { token: "--color-success-500" },
  "chart-warning": { token: "--color-warning-500" },
  "chart-critical": { token: "--color-error-500" },
  // Over-provisioning is a COST story, not a health one, so it gets the purple ramp rather than a fourth health hue.
  "chart-cost": { token: "--color-purple-500" },
  "chart-axis": { token: "--color-border-default" },
  "chart-label": { token: "--color-text-secondary" },
  "chart-zone-label": { token: "--color-text-muted" },
  "chart-guide": { token: "--color-border-subtle" },
  "chart-grid": { token: "--color-chart-gridline" },
  "chart-surface": { token: "--color-surface-base" },
  // The house tooltip styling every dashboard panel uses (convertPromQLData.ts:377-392).
  "tooltip-bg": { token: "--color-tooltip-bg" },
  "tooltip-text": { token: "--color-tooltip-text" },
  "tooltip-border": { token: "--color-tooltip-border" },
  // Alpha, NOT the -50 tints: those are near-white and theme-independent, so they paint an opaque block on a dark surface.
  "zone-hot": { token: "--color-error-500", alpha: 0.22 },
  // CPU- and Memory-bound are the SAME severity on different resources, so they share an alpha and separate by hue instead.
  "zone-cpu": { token: "--color-warning-500", alpha: 0.2 },
  "zone-mem": { token: "--color-info", alpha: 0.2 },
  "zone-cold": { token: "--color-purple-500", alpha: 0.18 },
  // ECharts ignores markArea decals, so the corner LABEL carries the second cue and is inked in its own zone hue.
  "zone-hot-ink": { token: "--color-error-500", alpha: 0.95 },
  "zone-cold-ink": { token: "--color-purple-500", alpha: 0.95 },
  "zone-cpu-ink": { token: "--color-warning-500", alpha: 0.95 },
  "zone-mem-ink": { token: "--color-info", alpha: 0.95 },
};

export interface UseCuratedPageResult {
  face: ComputedRef<"unknown" | "undetected" | "dormant" | "ready">;
  l0State: Ref<WorkloadState>;
  loadError: Ref<boolean>;
  dashboard: Ref<Record<string, unknown> | null>;
  hiddenGroups: Ref<HiddenGroupInfo[]>;
  partialGroups: Ref<PartialGroupInfo[]>;
  staleGroups: Ref<StaleGroupInfo[]>;
  warnings: Ref<CuratedWarning[]>;
  lastDataUs: Ref<number | null>;
  stripAutoExpand: Ref<boolean>;
  /** Groups with ≥1 rendering panel — a strip row for one of these is a FIELD gap, not a missing collector. */
  presentGroupIds: Ref<string[]>;
  /** start/end are MICROSECOND epochs — the native unit of stats.doc_time_max. */
  refresh: (args: { orgId: string; start: number; end: number; force?: boolean }) => Promise<void>;
  /** Remember a picker's fetched values so a re-resolve re-emits them. */
  rememberPickerOptions: (variables: unknown) => void;
}

export function useCuratedPage(
  manifest: CuratedPageManifest,
  opts?: {
    pins?: MaybeRefOrGetter<CuratedPagePins | undefined>;
    lastSeenUs?: MaybeRefOrGetter<number | undefined>;
    /** The page's SELECTED window, threaded onto drilldown URLs (§6.6). */
    drilldownRange?: MaybeRefOrGetter<{ period?: string; from?: number; to?: number } | undefined>;
  },
): UseCuratedPageResult {
  const store = useStore();
  const { getStreams, getStream } = useStreams(gt);

  // A re-resolve re-initializes the variables manager, which never re-fetches an
  // all-sentinel picker — so the options loaded so far have to ride the new build.
  const pickerOptions: Record<string, PickerOption[]> = {};

  // Read per refresh, never snapshotted: the drawer is reused across ?host= switches and lastSeenUs lands after mount.
  const readPins = (): CuratedPagePins => toValue(opts?.pins) ?? {};
  const readLastSeenUs = (): number | undefined => toValue(opts?.lastSeenUs);
  const readDrilldownRange = () => toValue(opts?.drilldownRange);

  const loadError = ref(false);
  const dashboard = shallowRef<Record<string, unknown> | null>(null);
  const hiddenGroups = ref<HiddenGroupInfo[]>([]);
  const partialGroups = ref<PartialGroupInfo[]>([]);
  const staleGroups = ref<StaleGroupInfo[]>([]);
  const warnings = ref<CuratedWarning[]>([]);
  // Raised outside resolveManifest, so a re-resolve replaces the resolver's half without dropping these.
  let ioWarnings: CuratedWarning[] = [];
  const lastDataUs = ref<number | null>(null);
  const stripAutoExpand = ref(false);

  const listsLoaded = ref(false);
  const presentGroupIds = ref<string[]>([]);
  const settledGroupIds = ref<string[]>([]);

  // Responses tagged with a superseded value are dropped on arrival (none of these calls take an AbortSignal).
  let generation = 0;
  let resolutionKey = "";
  // Kept so a theme swap can rebuild from the SAME resolution: the palette lives in the built panels, not the resolver.
  let lastResolution: CuratedResolution | null = null;
  const probeCache = new Map<string, ProbeVerdict>();
  // Session state: presence and concept passes never re-run without `force` (§5.6 warm-path budget).
  let cachedLists: Record<string, StreamListEntry[]> | null = null;
  let cachedGroups: FieldAlias[] | null = null;
  let dictionaryUnavailable = false;
  // The shared cache writes on success ONLY, so without this every refresh re-fires the doomed 403.
  const forbiddenOrgs = new Set<string>();
  let cachedOrgId = "";

  const probeGroups = manifest.groups.filter((group) => group.probe);

  /** Back to `unknown`: what was resolved describes an org or a list we no longer trust. */
  const resetResolution = () => {
    presentGroupIds.value = [];
    settledGroupIds.value = [];
    listsLoaded.value = false;
    dashboard.value = null;
    resolutionKey = "";
    lastResolution = null;
    hiddenGroups.value = [];
    partialGroups.value = [];
    staleGroups.value = [];
    lastDataUs.value = null;
  };

  const face = computed<"unknown" | "undetected" | "dormant" | "ready">(() => {
    // `ready` flips on the FIRST passing group; `undetected` claims ABSENCE, so it waits for every ladder to settle.
    if (presentGroupIds.value.length > 0) return "ready";
    if (!listsLoaded.value) return "unknown";
    if (settledGroupIds.value.length < manifest.groups.length) return "unknown";
    // The streams EXIST and merely stopped reporting — "install a collector" is
    // the wrong instruction for an org that already has one. `state: "stale"` is
    // positive evidence off a successfully fetched list, so this is not a guess.
    if (
      hiddenGroups.value.some((hidden) =>
        hidden.missingStreams.some((entry) => entry.state === "stale"),
      )
    ) {
      return "dormant";
    }
    return "undetected";
  });

  // L0 derives from the lists tier 1 already read — the same signature useWorkloadDetection applies, at zero extra cost.
  const l0State = ref<WorkloadState>("unknown");

  /** The types the pack's own groups query — the page cannot resolve without these. */
  const streamTypes = [...new Set(manifest.groups.map((group) => group.streamType))];
  /** Read for the L0 signature only, so a failure here never blocks the face. */
  const l0OnlyTypes = (["metrics", "logs"] as CuratedStreamType[]).filter(
    (type) => !streamTypes.includes(type),
  );

  const refresh = async (args: {
    orgId: string;
    start: number;
    end: number;
    force?: boolean;
  }): Promise<void> => {
    const gen = ++generation;
    ioWarnings = [];
    dictionaryUnavailable = false;
    const force = args.force === true;
    if (force) {
      clearSchemaReadsForOrg(args.orgId);
      forbiddenOrgs.delete(args.orgId);
      cachedLists = null;
      cachedGroups = null;
      probeCache.clear();
    }
    if (args.orgId !== cachedOrgId) {
      cachedOrgId = args.orgId;
      cachedLists = null;
      cachedGroups = null;
      // schemaReads is NOT cleared: it is keyed by org, so no org can be served another's schema and a switch back stays warm.
      probeCache.clear();
      // Without this the previous org's dashboard stays mounted, firing its queries against the NEW org id.
      resetResolution();
    }

    // ── Tier 1: the stream lists — the one hard dependency ──────────────────
    let lists = cachedLists;
    if (!lists) {
      try {
        const responses = await Promise.all(
          streamTypes.map((type) => getStreams(type, false, false, force)),
        );
        if (gen !== generation) return;
        lists = Object.fromEntries(
          streamTypes.map((type, index) => [
            type,
            (
              ((responses[index] as { list?: StreamListEntry[] })?.list ?? []) as StreamListEntry[]
            ).map((entry) => ({ ...entry })),
          ]),
        );
      } catch {
        if (gen !== generation) return;
        // `unknown` + loadError is the lists-failed state; the previous resolution goes with it rather than standing stale.
        cachedLists = null;
        resetResolution();
        loadError.value = true;
        return;
      }
      cachedLists = lists;
      // DELIBERATELY not awaited: these only colour the setup face's copy and must never hold a page that can resolve.
      // ALIAS of the shared cache, safe only because l0OnlyTypes is the strict
      // COMPLEMENT of streamTypes — these writes add keys the resolution never reads.
      const settled = lists;
      for (const type of l0OnlyTypes) {
        void getStreams(type, false, false, force)
          .then((response) => {
            if (gen !== generation) return;
            const list = (response as { list?: StreamListEntry[] })?.list;
            if (!list) return;
            settled[type] = list.map((entry) => ({ ...entry }));
            l0State.value = workloadStateFromNames(manifest.id, listNames(settled));
          })
          .catch(() => {});
      }
    }
    loadError.value = false;
    if (gen !== generation) return;
    l0State.value = workloadStateFromNames(manifest.id, listNames(lists));

    // A first pass off the lists alone tells us which schemas and whether the dictionary are needed at all.
    const dryRun = resolveManifest({
      manifest,
      streams: lists,
      semanticGroups: [],
      range: { start: args.start, end: args.end },
      now: args.end,
      pins: readPins(),
      lastSeenUs: readLastSeenUs(),
    });

    // Probe-candidate schemas are NOT fetched here: the walk stops at its first viable candidate.
    let groups = cachedGroups;
    const dictionaryReady = (async () => {
      if (groups) return;
      groups = await loadDictionary(
        args.orgId,
        force,
        dryRun.needsSemanticGroups,
        gen,
        () => generation,
      );
      if (groups.length > 0) cachedGroups = groups;
    })();
    const schemasReady = loadSchemas(dryRun.schemasNeeded, lists, force, args.orgId, gen);

    // Rung-1 panels need no schema, so they resolve and start querying while the schema tier is still in flight.
    await dictionaryReady;
    if (gen !== generation) return;
    const early = resolveManifest({
      manifest,
      streams: lists,
      semanticGroups: groups ?? [],
      range: { start: args.start, end: args.end },
      now: args.end,
      pins: readPins(),
      lastSeenUs: readLastSeenUs(),
      probeVerdicts: {},
      dictionaryUnavailable,
      schemasPending: true,
    });
    if (early.presentGroupIds.length > 0) applyResolution(early);

    await schemasReady;
    if (gen !== generation) return;
    const dictionary: FieldAlias[] = groups ?? [];

    // Resolve BEFORE marking the ladders settled, or presentGroupIds is still empty and the face reads absence.
    applyResolution(
      resolveManifest({
        manifest,
        streams: lists,
        semanticGroups: dictionary,
        range: { start: args.start, end: args.end },
        now: args.end,
        pins: readPins(),
        lastSeenUs: readLastSeenUs(),
        // An EMPTY map, not `undefined`: undefined lets a probe group resolve present off its candidate alone.
        probeVerdicts: {},
        dictionaryUnavailable,
      }),
    );
    settledGroupIds.value = manifest.groups
      .filter((group) => !group.probe)
      .map((group) => group.id);

    // ── Tier 3: the probe COUNTs, all concurrent under one shared budget ────
    const verdicts = await runProbes({
      orgId: args.orgId,
      start: args.start,
      end: args.end,
      force,
      now: args.end,
      gen,
      lists,
      onSettled: (groupId, verdict) => {
        if (gen !== generation) return;
        applyResolution(
          resolveManifest({
            manifest,
            streams: lists,
            semanticGroups: dictionary,
            range: { start: args.start, end: args.end },
            now: args.end,
            pins: readPins(),
            lastSeenUs: readLastSeenUs(),
            probeVerdicts: { ...collected, [groupId]: verdict },
            dictionaryUnavailable,
          }),
        );
        settledGroupIds.value = [...new Set([...settledGroupIds.value, groupId])];
      },
      collect: (groupId, verdict) => {
        collected[groupId] = verdict;
      },
    });
    if (gen !== generation) return;

    applyResolution(
      resolveManifest({
        manifest,
        streams: lists,
        semanticGroups: dictionary,
        range: { start: args.start, end: args.end },
        now: args.end,
        pins: readPins(),
        lastSeenUs: readLastSeenUs(),
        probeVerdicts: verdicts,
        dictionaryUnavailable,
      }),
    );
    settledGroupIds.value = manifest.groups.map((group) => group.id);
  };

  /** Verdicts gathered so far, so an early settle can render its own group. */
  let collected: Record<string, ProbeVerdict> = {};

  const loadSchemas = async (
    names: string[],
    lists: Record<string, StreamListEntry[]>,
    force: boolean,
    orgId: string,
    gen: number,
  ): Promise<void> => {
    // Absent names are skipped: a schema read against a proven-absent stream spends a request to learn what we know.
    const present = names.filter((name) =>
      Object.entries(lists).some(([, entries]) => entries.some((entry) => entry.name === name)),
    );
    await Promise.all(
      present.map(async (name) => {
        const type =
          Object.entries(lists).find(([, entries]) =>
            entries.some((entry) => entry.name === name),
          )?.[0] ?? "metrics";
        try {
          const key = schemaKey(orgId, type, name);
          let read = cachedSchemaRead(key);
          if (!read) {
            read = getStream(name, type, true, force) as Promise<StreamListEntry | undefined>;
            // A superseded generation must not repopulate the map the org change just cleared.
            if (gen === generation) schemaReads.set(key, { at: Date.now(), read });
          }
          const fetched = await read;
          if (!fetched?.schema?.length) return;
          const entries = lists[type] ?? [];
          const index = entries.findIndex((entry) => entry.name === name);
          if (index < 0) return;
          // UNION, never replace: the list entry and the fetched schema are two reads of one stream.
          const merged = [...(entries[index].schema ?? []), ...fetched.schema];
          const unique = new Map(merged.map((field) => [field.name, field]));
          entries[index] = { ...entries[index], schema: [...unique.values()] };
        } catch {
          // A failed schema read resolves and renders (§5.4 error paths).
          ioWarnings = pushWarning(ioWarnings, {
            kind: "schema",
            message: raw(`schema unavailable for ${name}`),
          });
        }
      }),
    );
  };

  const runProbes = async (args: {
    orgId: string;
    start: number;
    end: number;
    force: boolean;
    now: number;
    gen: number;
    lists: Record<string, StreamListEntry[]>;
    onSettled: (groupId: string, verdict: ProbeVerdict) => void;
    collect: (groupId: string, verdict: ProbeVerdict) => void;
  }): Promise<Record<string, ProbeVerdict>> => {
    collected = {};
    if (probeGroups.length === 0) return {};

    const bucket = `${args.orgId}:${Math.floor(args.start / BUCKET_US)}:${Math.floor(args.end / BUCKET_US)}`;

    const settle = (groupId: string, verdict: ProbeVerdict) => {
      // A verdict from a superseded refresh was computed against the previous org's or range's lists.
      if (args.gen !== generation) return;
      args.collect(groupId, verdict);
      probeCache.set(`${bucket}:${groupId}`, verdict);
      if (verdict.warn) {
        ioWarnings = pushWarning(ioWarnings, { kind: "probe", message: raw(groupId) });
      }
      args.onSettled(groupId, verdict);
    };

    const runs = probeGroups.map(async (group) => {
      const cached = args.force ? undefined : probeCache.get(`${bucket}:${group.id}`);
      if (cached) {
        settle(group.id, cached);
        return;
      }

      const walk = await walkCandidates(
        group,
        args.lists,
        args.force,
        args.now,
        args.start,
        args.orgId,
        args.gen,
      );
      if (!walk.stream) {
        settle(group.id, {
          passed: false,
          // A column miss on a present stream is different evidence from a name nothing in the list carries.
          reason: walk.furthest ? "probe-empty" : "streams-missing",
          stream: walk.furthest,
          ...(walk.furthest ? { missingFields: walk.missingFields } : {}),
        });
        return;
      }
      const resolved = walk.stream;

      try {
        const response: any = await searchService.search(
          {
            org_identifier: args.orgId,
            query: {
              query: {
                // Author-controlled and list-validated today; escaped so a stream name carrying a quote cannot break out.
                sql: `SELECT COUNT(*) as zo_count FROM "${resolved.replace(/"/g, '""')}" WHERE (${group.probe!.sqlFilter})`,
                start_time: args.start,
                end_time: args.end,
                from: 0,
                size: 1,
              },
            },
            page_type: "logs",
          },
          "ui",
        );
        const count = Number(response?.data?.hits?.[0]?.zo_count ?? 0);
        settle(group.id, {
          stream: resolved,
          passed: count > 0,
          ...(count > 0 ? {} : { reason: "probe-empty" as const }),
        });
      } catch (error) {
        const unknownField = unknownFieldFrom(error);
        if (unknownField) {
          // Deterministic schema evidence over the query channel, so it hides rather than rendering a banner.
          settle(group.id, {
            stream: resolved,
            passed: false,
            reason: "probe-empty",
            missingFields: [unknownField],
          });
          return;
        }
        settle(group.id, { stream: resolved, passed: true, warn: true });
      }
    });

    // One shared client budget, so a hung probe cannot hold the face indefinitely.
    let expire!: () => void;
    const budget = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PROBE_TIMEOUT_MS);
      expire = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    await Promise.race([Promise.all(runs).then(expire), budget]);

    for (const group of probeGroups) {
      if (!collected[group.id]) settle(group.id, { passed: true, warn: true });
    }
    return { ...collected };
  };

  /** RenderDashboardCharts emits { isVariablesLoading, values } — see its getMergedVariablesForPanel. */
  const rememberPickerOptions = (variables: unknown) => {
    const values = (variables as { values?: unknown })?.values;
    if (!Array.isArray(values)) return;
    for (const variable of values as { name?: string; options?: PickerOption[] }[]) {
      if (!variable?.name || !Array.isArray(variable.options)) continue;
      if (variable.options.length === 0) continue;
      pickerOptions[variable.name] = variable.options;
    }
  };

  const applyResolution = (resolution: CuratedResolution) => {
    lastResolution = resolution;
    hiddenGroups.value = resolution.hiddenGroups;
    partialGroups.value = resolution.partialGroups;
    staleGroups.value = resolution.staleGroups;
    lastDataUs.value = resolution.lastDataUs;
    stripAutoExpand.value = resolution.stripAutoExpand;
    presentGroupIds.value = resolution.presentGroupIds;
    listsLoaded.value = true;
    let merged = [...ioWarnings];
    for (const warning of resolution.warnings) merged = pushWarning(merged, warning);
    warnings.value = merged;

    // Swapped only when resolution output changed (the renderer re-inits on ANY new object); pins are hashed because they substitute INTO the queries.
    const key = resolutionHash(resolution, readPins(), store.state.theme);
    if (key !== resolutionKey || dashboard.value === null) {
      resolutionKey = key;
      const built = buildDashboard(manifest, resolution, readPins(), {
        timezone: store.state.timezone ?? "UTC",
        nowUs: Date.now() * 1000,
        drilldownRange: readDrilldownRange(),
        pickerOptions,
      });
      // buildDashboard emits KEYS and raw ${theme:} tokens, so both are resolved here — outside the pure layer, once per build.
      dashboard.value = translateTitles(built, manifest);
    }
  };

  // `post` flush: App.vue's theme watcher must have dropped chartTheme's cache first, or this re-resolves the OLD palette.
  watch(
    () => store.state.theme,
    () => {
      if (lastResolution) applyResolution(lastResolution);
    },
    { flush: "post" },
  );

  const loadDictionary = async (
    orgId: string,
    force: boolean,
    needed: boolean,
    gen: number,
    current: () => number,
  ): Promise<FieldAlias[]> => {
    // The hosts pack resolves entirely at rung 1, so it never asks at all.
    if (!needed) return [];
    if (!force && forbiddenOrgs.has(orgId)) {
      dictionaryUnavailable = true;
      return [];
    }
    if (force) clearSemanticGroupsCacheForOrg(orgId);

    let failure: any = null;
    const groups = await loadSemanticGroups(orgId, (err) => {
      failure = err;
    });
    if (gen !== current()) return groups;

    const status = failure?.response?.status;
    if (status === 403) {
      // Expected on OSS until the groups are exposed there: silent, and negative-cached against a re-fire.
      forbiddenOrgs.add(orgId);
      dictionaryUnavailable = true;
      return [];
    }
    if (failure) {
      ioWarnings = pushWarning(ioWarnings, {
        kind: "semantic-groups",
        message: raw("semantic groups are unavailable"),
      });
      dictionaryUnavailable = true;
      return [];
    }
    if (groups.length === 0) {
      // A 200 with no dictionary is a real misconfiguration and, unlike a 403, it can fix itself.
      ioWarnings = pushWarning(ioWarnings, {
        kind: "groups-missing",
        message: raw("this org has no semantic field groups"),
      });
    }
    return groups;
  };

  /**
   * §5.2 pass 1b step 1 — ordered evidence, not a scan: the walk STOPS at the
   * first candidate that is present, live and carries every probe column, so a
   * later candidate's schema is never read. A column miss CONTINUES the walk.
   */
  const walkCandidates = async (
    group: CuratedPageManifest["groups"][number],
    lists: Record<string, StreamListEntry[]>,
    force: boolean,
    now: number,
    rangeStart: number,
    orgId: string,
    gen: number,
  ): Promise<{ stream?: string; furthest?: string; missingFields?: string[] }> => {
    const entries = lists[group.streamType] ?? [];
    const floor = Math.min(rangeStart, now - STALENESS_24H_US);
    let furthest: string | undefined;
    let missingFields: string[] | undefined;

    for (const name of group.probe!.streams) {
      const listed = entries.find((entry) => entry.name === name);
      if (!listed) continue;
      const seen = listed.stats?.doc_time_max;
      if (typeof seen === "number" && seen !== 0 && seen < floor) continue;
      furthest = name;

      // The name list is a NAME list (getStreams forces schema=false), and hiding a group is too strong a call on a maybe-stale entry.
      let schema: StreamListEntry["schema"];
      try {
        const key = schemaKey(orgId, group.streamType, name);
        let read = cachedSchemaRead(key);
        if (!read) {
          read = getStream(name, group.streamType, true, force) as Promise<
            StreamListEntry | undefined
          >;
          if (gen === generation) schemaReads.set(key, { at: Date.now(), read });
        }
        const fetched = await read;
        schema = fetched?.schema ?? null;
        const index = entries.findIndex((entry) => entry.name === name);
        if (index >= 0 && fetched?.schema) entries[index] = { ...entries[index], ...fetched };
      } catch {
        // A failed pre-check renders the group rather than hiding it.
        return { stream: name, furthest: name };
      }

      const fields = new Set((schema ?? []).map((field) => field.name));
      const absent = group.probe!.fields.filter((column) => !fields.has(column));
      if (absent.length === 0) return { stream: name, furthest: name };
      missingFields = absent;
    }
    return { furthest, missingFields };
  };

  return {
    face,
    l0State,
    loadError,
    dashboard,
    hiddenGroups,
    partialGroups,
    staleGroups,
    warnings,
    lastDataUs,
    stripAutoExpand,
    presentGroupIds,
    refresh,
    rememberPickerOptions,
  };
}

/** Resolve the titleKeys buildDashboard emitted into copy the renderer prints, plus the author-JS theme tokens. */
function translateTitles(
  built: Record<string, unknown>,
  manifest: CuratedPageManifest,
): Record<string, unknown> {
  const sectionName = (tabId: string) =>
    manifest.sections.find((section) => section.id === tabId)?.titleKey;
  return {
    ...built,
    title: gt(manifest.titleKey),
    tabs: ((built.tabs ?? []) as any[]).map((tab) => {
      const key = sectionName(tab.tabId);
      return {
        ...tab,
        name: key ? gt(key) : tab.name,
        panels: (tab.panels ?? []).map((panel: any) => ({
          ...panel,
          title: gt(panel.title),
          ...(typeof panel.customChartContent === "string"
            ? { customChartContent: substituteThemeTokens(panel.customChartContent) }
            : {}),
        })),
      };
    }),
  };
}

/**
 * Resolve `${theme:NAME}` in author JS to a concrete colour.
 *
 * The custom-chart sandbox runs under `default-src 'none'; style-src 'none'`, so no
 * stylesheet reaches it and it can never resolve a `--color-*` token itself. Deliberately
 * NOT substituteQuery: that ends in tidyMatchers, PromQL brace surgery that turns
 * `option = {}` into `option = ;`.
 */
function substituteThemeTokens(code: string): string {
  return code.replace(/\$\{theme:([a-z0-9-]+)\}/gi, (whole, name: string) => {
    const entry = CHART_THEME_TOKENS[name.toLowerCase()];
    if (!entry) return whole;
    const resolved = chartColor(entry.token);
    return entry.alpha === undefined ? resolved : colorToRgba(resolved, entry.alpha);
  });
}

function listNames(lists: Record<string, StreamListEntry[]>) {
  return {
    metrics: lists.metrics ? lists.metrics.map((entry) => entry.name) : null,
    logs: lists.logs ? lists.logs.map((entry) => entry.name) : null,
  };
}

function pushWarning(current: CuratedWarning[], warning: CuratedWarning): CuratedWarning[] {
  if (current.some((entry) => entry.kind === warning.kind && entry.message === warning.message)) {
    return current;
  }
  return [...current, warning];
}

/** A 400 naming an unknown field is schema evidence, not a transport failure. */
function unknownFieldFrom(error: any): string | null {
  if (error?.response?.status !== 400) return null;
  const message = String(error?.response?.data?.message ?? "");
  const match = /unknown field '([^']+)'|unrecognized field '([^']+)'/i.exec(message);
  return match ? (match[1] ?? match[2]) : null;
}

/** Selected variants + resolved fields + surviving pickers/sections + badges + pins + theme. */
function resolutionHash(
  resolution: CuratedResolution,
  pins: CuratedPagePins,
  theme: unknown,
): string {
  return JSON.stringify({
    pins,
    // Author-JS colours are baked in at build time, so a theme swap must invalidate the built dashboard.
    theme: theme ?? null,
    panels: resolution.panels
      .filter((panel) => !panel.hidden)
      // noDataYet branches what buildPanel emits, so it must move the hash.
      .map((panel) => [panel.id, panel.queryStream, panel.unit, panel.resolvedFields]),
    pickers: resolution.pickers.map((picker) => [picker.def.name, picker.field, picker.label]),
    stale: resolution.staleGroups.map((stale) => [
      stale.group.id,
      stale.lastSeenUs,
      stale.noDataYet === true,
    ]),
  });
}
