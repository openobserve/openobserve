// Copyright 2026 OpenObserve Inc.

import { computed, ref, shallowRef } from "vue";

import ocsfPacks from "@/services/ocsfPacks";
import { runSql } from "@/composables/security/useSecurityStreamPlans";
import streamService from "@/services/stream";
import type { SecuritySetting } from "@/utils/security/ocsfPipeline";
import { quoteIdent } from "@/utils/security/sql";
import {
  isLocalPrefsMigrated,
  judgeStream,
  loadSourcePrefs,
  markLocalPrefsMigrated,
  pendingIncludeMigrations,
  resolveSources,
  saveSourcePrefs,
  sourcesFromSettings,
  staleStreams,
  streamKey,
  streamsWithIncludeSetting,
  suggestedSources,
  unsampledKey,
  type CachedVerdict,
  type SourcePrefs,
  type StreamWithSecurity,
} from "@/utils/security/sourceSelection";
import { loadTaggedStreams, saveTaggedStreams } from "@/utils/security/streams";

const CLASSIFY_CONCURRENCY = 2;
/** Streams classified per page load; the busiest go first and the rest follow on later loads. */
const CLASSIFY_PER_LOAD = 40;
const SAMPLE_ROWS = 30;
const SAMPLE_WINDOW_US = 3_600_000_000;

export interface StreamInfo {
  name: string;
  stats?: { created_at?: number; doc_num?: number; doc_time_min?: number; doc_time_max?: number };
  [key: string]: unknown;
}

/** One classification pass per org at a time, shared by every page that mounts. */
const running = new Map<string, Promise<void>>();

async function sampleRows(orgId: string, stream: string): Promise<Record<string, unknown>[]> {
  const endUs = Date.now() * 1000;
  try {
    const { hits } = await runSql(
      orgId,
      `SELECT * FROM ${quoteIdent(stream)}`,
      endUs - SAMPLE_WINDOW_US,
      endUs,
      SAMPLE_ROWS,
    );
    return hits;
  } catch {
    return [];
  }
}

async function classifyOne(orgId: string, stream: StreamInfo): Promise<CachedVerdict | null> {
  let fields: string[] = [];
  try {
    const res = await streamService.schema(orgId, stream.name, "logs");
    fields = (res.data?.schema ?? []).map((f: { name: string }) => f.name);
  } catch {
    return null;
  }
  const samples = await sampleRows(orgId, stream.name);
  const verdict = judgeStream(fields, samples);
  return {
    key: samples.length ? streamKey(stream.stats) : unsampledKey(stream.stats),
    decision: verdict?.decision ?? "ignored",
    sourceId: verdict?.sourceId ?? "",
    label: verdict?.label ?? "",
    confidence: verdict?.confidence ?? 0,
  };
}

export function useSecuritySources() {
  const orgId = ref("");
  const streams = shallowRef<StreamInfo[]>([]);
  const prefs = ref<SourcePrefs>({ include: [], exclude: [], dismissed: [], classified: {} });
  const loading = ref(false);
  const classifying = ref(false);
  const error = ref("");

  const names = computed(() => streams.value.map((s) => s.name));
  const asSecurityStreams = (): StreamWithSecurity[] =>
    streams.value.map((s) => ({ name: s.name, settings: (s as StreamWithSecurity).settings }));
  const settingSources = computed(() => sourcesFromSettings(asSecurityStreams()));
  const settingNames = computed(
    () =>
      new Set(
        asSecurityStreams()
          .filter((s) => s.settings?.security)
          .map((s) => s.name),
      ),
  );
  // Streams carrying a setting are governed by it, not by the local classification.
  const legacyNames = computed(() => names.value.filter((n) => !settingNames.value.has(n)));
  const sources = computed(() => resolveSources(legacyNames.value, prefs.value));
  // An excluded setting (included === false) is not a source, even when a pack is mapped.
  const sourceNames = computed(() => [
    ...new Set([
      ...settingSources.value.filter((s) => s.included).map((s) => s.name),
      ...sources.value.map((s) => s.name),
    ]),
  ]);
  const suggestions = computed(() => suggestedSources(legacyNames.value, prefs.value));

  /** Saves the user's choices, keeping verdicts another page's classification pass stored meanwhile. */
  function persist() {
    const stored = loadSourcePrefs(orgId.value);
    prefs.value = {
      ...prefs.value,
      classified: { ...stored.classified, ...prefs.value.classified },
    };
    saveSourcePrefs(orgId.value, prefs.value);
  }

  /** Stores one verdict on top of whatever choices are saved now, so it never undoes one. */
  function storeVerdict(org: string, name: string, verdict: CachedVerdict) {
    const stored = loadSourcePrefs(org);
    stored.classified[name] = verdict;
    saveSourcePrefs(org, stored);
    if (org === orgId.value) prefs.value = stored;
  }

  async function classify() {
    const org = orgId.value;
    const pending = running.get(org);
    if (pending) {
      classifying.value = true;
      await pending;
      if (org === orgId.value) prefs.value = loadSourcePrefs(org);
      classifying.value = false;
      return;
    }
    const byName = new Map(streams.value.map((s) => [s.name, s]));
    const queue = staleStreams(streams.value, prefs.value)
      .slice(0, CLASSIFY_PER_LOAD)
      .map((name) => byName.get(name)!);
    if (!queue.length) return;
    classifying.value = true;
    const work = (async () => {
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const verdict = await classifyOne(org, next);
          if (verdict) storeVerdict(org, next.name, verdict);
          if (org !== orgId.value) return;
        }
      };
      await Promise.all(Array.from({ length: CLASSIFY_CONCURRENCY }, worker));
    })();
    running.set(org, work);
    try {
      await work;
    } finally {
      running.delete(org);
      if (org === orgId.value) classifying.value = false;
    }
  }

  /** Loads the stream list and preferences; classification continues in the background. */
  async function load(org: string, { fetchSchema = false } = {}) {
    if (!org) return;
    orgId.value = org;
    const loaded = loadSourcePrefs(org);
    // Streams added by hand before content classification existed stay sources.
    const legacy = loadTaggedStreams(org).filter((n) => !loaded.include.includes(n));
    prefs.value = { ...loaded, include: [...loaded.include, ...legacy] };
    if (legacy.length) {
      saveSourcePrefs(org, prefs.value);
      // Cleared once migrated, or removing a source would bring it back next load.
      saveTaggedStreams(org, []);
    }
    loading.value = true;
    error.value = "";
    try {
      const res = await streamService.nameList(org, "logs", fetchSchema);
      if (org !== orgId.value) return;
      streams.value = res.data?.list ?? [];
    } catch (e: any) {
      if (org !== orgId.value) return;
      error.value = e?.response?.data?.message ?? e?.message ?? "";
    } finally {
      if (org === orgId.value) loading.value = false;
    }
    void classify();
  }

  function include(name: string) {
    prefs.value.include = [...new Set([...prefs.value.include, name])];
    prefs.value.exclude = prefs.value.exclude.filter((n) => n !== name);
    prefs.value.dismissed = prefs.value.dismissed.filter((n) => n !== name);
    persist();
  }

  function exclude(name: string) {
    prefs.value.exclude = [...new Set([...prefs.value.exclude, name])];
    prefs.value.include = prefs.value.include.filter((n) => n !== name);
    persist();
  }

  function dismiss(name: string) {
    prefs.value.dismissed = [...new Set([...prefs.value.dismissed, name])];
    persist();
  }

  /** Moves local include/exclude choices into stream settings once, for a user who can write them. */
  async function migrateIncludes(canWrite: boolean) {
    const org = orgId.value;
    if (!canWrite || !org || isLocalPrefsMigrated(org)) return;
    // A failed stream load leaves streams empty; marking migrated now would silently drop every choice.
    if (error.value || !streams.value.length) return;
    const live = new Set(names.value);
    const byName = new Map(asSecurityStreams().map((s) => [s.name, s.settings?.security]));
    const pending = pendingIncludeMigrations(org, streamsWithIncludeSetting(asSecurityStreams()));
    for (const item of pending) {
      // A local choice for a stream the loaded list does not contain can never succeed; skip it.
      if (!live.has(item.name)) continue;
      const current = byName.get(item.name);
      const setting: SecuritySetting = current
        ? { ...current, included: item.included }
        : {
            source_type: "",
            pack_id: "",
            pack_version: 0,
            attached_at: 0,
            pipeline_id: "",
            pipeline_created: false,
            included: item.included,
          };
      try {
        await ocsfPacks.saveSetting(org, item.name, setting);
      } catch (e: any) {
        const status = e?.response?.status;
        // Only a permanent 400/404 is skipped; anything else aborts unmarked so the choices retry next load.
        if (status === 400 || status === 404) continue;
        return;
      }
    }
    markLocalPrefsMigrated(org);
  }

  return {
    streams,
    sources,
    settingSources,
    sourceNames,
    suggestions,
    loading,
    classifying,
    error,
    load,
    include,
    exclude,
    dismiss,
    migrateIncludes,
  };
}
