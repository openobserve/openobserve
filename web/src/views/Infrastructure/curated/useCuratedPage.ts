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

// The curated engine's orchestration layer (design §5.1-§5.6): tiered fetches,
// the probe candidate ladder under a client budget, the semantic-groups error
// ladder, force propagation, generations and an identity-stable dashboard ref.

import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import { useStore } from "vuex";
import type { FieldAlias } from "@/services/service_streams";
import useStreams from "@/composables/useStreams";
import searchService from "@/services/search";
import { loadSemanticGroups, clearSemanticGroupsCacheForOrg } from "@/utils/semanticGroupsCache";
import { workloadStateFromNames, type WorkloadState } from "@/composables/useWorkloadDetection";
import { gt, raw } from "@/types/i18n";
import {
  buildDashboard,
  resolveManifest,
  type CuratedResolution,
  type CuratedWarning,
  type HiddenGroupInfo,
  type PartialGroupInfo,
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

export interface UseCuratedPageResult {
  face: ComputedRef<"unknown" | "undetected" | "ready">;
  l0State: Ref<WorkloadState>;
  loadError: Ref<boolean>;
  dashboard: Ref<Record<string, unknown> | null>;
  hiddenGroups: Ref<HiddenGroupInfo[]>;
  partialGroups: Ref<PartialGroupInfo[]>;
  staleGroups: Ref<StaleGroupInfo[]>;
  warnings: Ref<CuratedWarning[]>;
  lastDataUs: Ref<number | null>;
  stripAutoExpand: Ref<boolean>;
  /** start/end are MICROSECOND epochs — the native unit of stats.doc_time_max. */
  refresh: (args: { orgId: string; start: number; end: number; force?: boolean }) => Promise<void>;
}

export function useCuratedPage(
  manifest: CuratedPageManifest,
  opts?: { pins?: CuratedPagePins; lastSeenUs?: number },
): UseCuratedPageResult {
  const store = useStore();
  const { getStreams, getStream } = useStreams(gt);

  const loadError = ref(false);
  const dashboard = shallowRef<Record<string, unknown> | null>(null);
  const hiddenGroups = ref<HiddenGroupInfo[]>([]);
  const partialGroups = ref<PartialGroupInfo[]>([]);
  const staleGroups = ref<StaleGroupInfo[]>([]);
  const warnings = ref<CuratedWarning[]>([]);
  // Raised outside resolveManifest (probe, schema, dictionary), so a re-resolve
  // replaces the resolver's half without dropping these.
  let ioWarnings: CuratedWarning[] = [];
  const lastDataUs = ref<number | null>(null);
  const stripAutoExpand = ref(false);

  const listsLoaded = ref(false);
  const presentGroupIds = ref<string[]>([]);
  const settledGroupIds = ref<string[]>([]);

  // Every refresh increments this; responses tagged with a superseded value are
  // dropped on arrival (none of these calls take an AbortSignal).
  let generation = 0;
  let resolutionKey = "";
  const probeCache = new Map<string, ProbeVerdict>();
  // Session state, so a range-only refresh costs nothing: presence and concept
  // passes never re-run without `force` (§5.6 warm-path budget).
  let cachedLists: Record<string, StreamListEntry[]> | null = null;
  let cachedGroups: FieldAlias[] | null = null;
  let dictionaryUnavailable = false;
  // Schemas read this SESSION, held as PROMISES: the candidate walks run
  // concurrently, so N groups sharing one candidate share one in-flight read,
  // and a range-only refresh re-reads nothing (§5.6 warm-path budget).
  const schemaReads = new Map<string, Promise<StreamListEntry | undefined>>();
  // Orgs whose semantic-groups read returned 403. The shared cache writes on
  // success ONLY, so without this every refresh re-fires the doomed request.
  const forbiddenOrgs = new Set<string>();
  let cachedOrgId = "";

  const probeGroups = manifest.groups.filter((group) => group.probe);

  const face = computed<"unknown" | "undetected" | "ready">(() => {
    // `ready` claims only "here is some data" — nothing arriving later can
    // falsify it, so it flips on the FIRST passing group. `undetected` claims
    // ABSENCE, so it waits for every ladder to settle.
    if (presentGroupIds.value.length > 0) return "ready";
    if (!listsLoaded.value) return "unknown";
    if (settledGroupIds.value.length < manifest.groups.length) return "unknown";
    return "undetected";
  });

  // L0 is derived from the lists tier 1 already read — the same signature
  // useWorkloadDetection applies, at zero extra request cost.
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
      schemaReads.clear();
      forbiddenOrgs.delete(args.orgId);
      cachedLists = null;
      cachedGroups = null;
      probeCache.clear();
    }
    if (args.orgId !== cachedOrgId) {
      cachedOrgId = args.orgId;
      cachedLists = null;
      cachedGroups = null;
      schemaReads.clear();
      probeCache.clear();
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
        // `unknown` alone means loading; `unknown` + loadError means the lists
        // themselves failed, and the view swaps the spinner for a Retry.
        cachedLists = null;
        loadError.value = true;
        listsLoaded.value = false;
        return;
      }
      cachedLists = lists;
      // The L0-only lists are best-effort and DELIBERATELY not awaited: they
      // only colour the setup face's copy, so neither their latency nor their
      // failure may hold or break a page that can already resolve.
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

    // A first pass off the lists alone tells us which schemas and whether the
    // dictionary are needed at all — the hosts pack answers "neither".
    const dryRun = resolveManifest({
      manifest,
      streams: lists,
      semanticGroups: [],
      range: { start: args.start, end: args.end },
      now: args.end,
      pins: opts?.pins,
      lastSeenUs: opts?.lastSeenUs,
    });

    // ── Tier 2: panel schemas and the dictionary, concurrently ─────────────
    // Probe-candidate schemas are NOT fetched here: the walk stops at its first
    // viable candidate, so reading them all up front would spend requests on
    // candidates the ladder never reaches.
    let groups = cachedGroups;
    await Promise.all([
      (async () => {
        if (groups) return;
        groups = await loadDictionary(
          args.orgId,
          force,
          dryRun.needsSemanticGroups,
          gen,
          () => generation,
        );
        if (groups.length > 0) cachedGroups = groups;
      })(),
      loadSchemas(dryRun.schemasNeeded, lists, force),
    ]);
    if (gen !== generation) return;
    const dictionary: FieldAlias[] = groups ?? [];

    settledGroupIds.value = manifest.groups
      .filter((group) => !group.probe)
      .map((group) => group.id);
    listsLoaded.value = true;

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
            pins: opts?.pins,
            lastSeenUs: opts?.lastSeenUs,
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
        pins: opts?.pins,
        lastSeenUs: opts?.lastSeenUs,
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
  ): Promise<void> => {
    // Absent names are skipped: a schema read against a stream the list already
    // proved absent spends a request to learn what we know.
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
          let read = schemaReads.get(name);
          if (!read) {
            read = getStream(name, type, true, force) as Promise<StreamListEntry | undefined>;
            schemaReads.set(name, read);
          }
          const fetched = await read;
          if (!fetched?.schema?.length) return;
          const entries = lists[type] ?? [];
          const index = entries.findIndex((entry) => entry.name === name);
          if (index < 0) return;
          // UNION, never replace: the list entry and the fetched schema are two
          // reads of one stream, and dropping either loses a real column.
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
      // A verdict from a superseded refresh must not reach the cache: it was
      // computed against the previous org's or range's lists.
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

      const walk = await walkCandidates(group, args.lists, args.force, args.now, args.start);
      if (!walk.stream) {
        settle(group.id, {
          passed: false,
          // A column miss on a stream that IS present is different evidence from
          // a name nothing in the list carries — the strip copy differs too.
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
                sql: `SELECT COUNT(*) as zo_count FROM "${resolved}" WHERE (${group.probe!.sqlFilter})`,
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
          // Deterministic schema evidence arriving over the query channel — not
          // a transport failure, so it hides rather than rendering a banner.
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

    // One shared client budget: expiry takes the transport-failure path so a
    // hung probe cannot hold the face indefinitely.
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

  const applyResolution = (resolution: CuratedResolution) => {
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

    // RenderDashboardCharts re-inits its whole variables manager on ANY new
    // object, so the reference is swapped only when resolution output changed.
    const key = resolutionHash(resolution);
    if (key !== resolutionKey || dashboard.value === null) {
      resolutionKey = key;
      const built = buildDashboard(manifest, resolution, opts?.pins ?? {}, {
        timezone: store.state.timezone ?? "UTC",
      });
      // buildDashboard is pure and i18n-free, so it emits KEYS; the renderer
      // prints titles verbatim, so they are resolved here — outside the pure
      // layer, and once per build rather than per render.
      dashboard.value = translateTitles(built, manifest);
    }
  };

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
      // Expected on OSS until the groups are exposed there: silent, and
      // negative-cached so a refresh does not re-fire the doomed request.
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
      // A 200 with no dictionary is a real misconfiguration, and unlike a 403
      // it can fix itself — so it warns and is not negative-cached.
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

      // A probe pre-check always reads the schema through getStream: the
      // name list is a NAME list (getStreams hard-forces schema=false), and
      // hiding a group is too strong a call to make on a maybe-stale entry.
      let schema: StreamListEntry["schema"];
      try {
        let read = schemaReads.get(name);
        if (!read) {
          read = getStream(name, group.streamType, true, force) as Promise<
            StreamListEntry | undefined
          >;
          schemaReads.set(name, read);
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
    refresh,
  };
}

/** Resolve the titleKeys buildDashboard emitted into copy the renderer prints. */
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
        panels: (tab.panels ?? []).map((panel: any) => ({ ...panel, title: gt(panel.title) })),
      };
    }),
  };
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

/** Selected variants + resolved fields + surviving pickers/sections + badges. */
function resolutionHash(resolution: CuratedResolution): string {
  return JSON.stringify({
    panels: resolution.panels
      .filter((panel) => !panel.hidden)
      .map((panel) => [panel.id, panel.queryStream, panel.unit, panel.resolvedFields]),
    pickers: resolution.pickers.map((picker) => [picker.def.name, picker.field, picker.label]),
    stale: resolution.staleGroups.map((stale) => [stale.group.id, stale.lastSeenUs]),
  });
}
