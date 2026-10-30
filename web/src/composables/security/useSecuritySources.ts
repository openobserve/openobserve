// Copyright 2026 OpenObserve Inc.

import { computed, ref, shallowRef } from "vue";

import searchService from "@/services/search";
import streamService from "@/services/stream";
import { quoteIdent } from "@/utils/security/sql";
import {
  judgeStream,
  loadSourcePrefs,
  resolveSources,
  saveSourcePrefs,
  staleStreams,
  streamKey,
  suggestedSources,
  unsampledKey,
  type CachedVerdict,
  type SourcePrefs,
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
    const res = await searchService.search(
      {
        org_identifier: orgId,
        query: {
          query: {
            sql: `SELECT * FROM ${quoteIdent(stream)}`,
            start_time: endUs - SAMPLE_WINDOW_US,
            end_time: endUs,
            from: 0,
            size: SAMPLE_ROWS,
          },
        },
        page_type: "logs",
      },
      "ui",
    );
    return res.data?.hits ?? [];
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
  const sources = computed(() => resolveSources(names.value, prefs.value));
  const sourceNames = computed(() => sources.value.map((s) => s.name));
  const suggestions = computed(() => suggestedSources(names.value, prefs.value));

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

  return {
    streams,
    sources,
    sourceNames,
    suggestions,
    loading,
    classifying,
    error,
    load,
    include,
    exclude,
    dismiss,
  };
}
