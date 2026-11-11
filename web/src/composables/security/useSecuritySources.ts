// Copyright 2026 OpenObserve Inc.

import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";

import { loadSecurityAccess } from "@/composables/security/useSecurityAccess";
import ocsfPacks from "@/services/ocsfPacks";
import type { SecuritySetting, SourceRow } from "@/services/securitySources";
import { classifySourcesMutation, securitySourcesQuery } from "@/services/securitySources.queries";
import {
  isLocalPrefsMigrated,
  loadSourcePrefs,
  markLocalPrefsMigrated,
  pendingIncludeMigrations,
  saveSourcePrefs,
} from "@/utils/security/sourcePrefs";
import { loadTaggedStreams, saveTaggedStreams } from "@/utils/security/streams";

const EMPTY_SETTING: SecuritySetting = {
  source_type: "",
  pack_id: "",
  pack_version: 0,
  attached_at: 0,
  pipeline_id: "",
  pipeline_created: false,
  included: null,
};

/** Orgs classified in this page session; the server keeps verdicts, so once per load is enough. */
const classifiedOrgs = new Set<string>();

/** The org's streams and Security sources, as the server lists them. */
export function useSecuritySources() {
  const orgId = ref("");
  const dismissed = ref<string[]>([]);
  const canWrite = ref(false);
  const query = useQuery(
    computed(() => ({ ...securitySourcesQuery(orgId.value), enabled: !!orgId.value })),
  );
  const classifyMutation = useMutation(computed(() => classifySourcesMutation(orgId.value)));

  const rows = computed<SourceRow[]>(() => query.data.value?.streams ?? []);
  const streams = computed(() =>
    rows.value.map((row) => ({
      name: row.name,
      stats: { doc_num: row.activity.doc_num, doc_time_max: row.activity.doc_time_max },
      settings: { security: row.setting },
    })),
  );
  const sources = computed(() => rows.value.filter((row) => row.reason !== null));
  const sourceNames = computed(() => query.data.value?.sources ?? []);
  const suggestions = computed(() => {
    const hidden = new Set(dismissed.value);
    const byName = new Map(rows.value.map((row) => [row.name, row]));
    return (query.data.value?.suggestions ?? [])
      .filter((name) => !hidden.has(name))
      .map((name) => byName.get(name))
      .filter((row): row is SourceRow => !!row);
  });
  const loading = computed(() => query.isLoading.value);
  const classifying = computed(() => classifyMutation.isPending.value);
  const error = computed(() => {
    const err = query.error.value as {
      response?: { data?: { message?: string } };
      message?: string;
    } | null;
    return err ? (err.response?.data?.message ?? err.message ?? "") : "";
  });

  const settingOf = (name: string): SecuritySetting | null =>
    rows.value.find((row) => row.name === name)?.setting ?? null;

  /** Loads the list; an author also has the server classify the streams that need it. */
  async function load(org: string) {
    if (!org) return;
    orgId.value = org;
    const prefs = loadSourcePrefs(org);
    // Streams added by hand before content classification existed migrate like other local choices.
    const legacy = loadTaggedStreams(org).filter((n) => !prefs.include.includes(n));
    if (legacy.length) {
      saveSourcePrefs(org, { ...prefs, include: [...prefs.include, ...legacy] });
      saveTaggedStreams(org, []);
    }
    dismissed.value = prefs.dismissed;
    const [, access] = await Promise.all([query.refetch(), loadSecurityAccess(org)]);
    if (org !== orgId.value) return;
    // Storing a classification verdict is an authoring write on the server.
    canWrite.value = access.author;
    if (canWrite.value && !classifiedOrgs.has(org)) {
      classifiedOrgs.add(org);
      classifyMutation.mutate([]);
    }
  }

  /** Records an explicit include or exclude on the server; throws when the save is refused. */
  async function setIncluded(name: string, included: boolean) {
    await ocsfPacks.saveSetting(orgId.value, name, {
      ...(settingOf(name) ?? EMPTY_SETTING),
      included,
    });
    await query.refetch();
  }

  const include = (name: string) => setIncluded(name, true);
  const exclude = (name: string) => setIncluded(name, false);

  function dismiss(name: string) {
    dismissed.value = [...new Set([...dismissed.value, name])];
    saveSourcePrefs(orgId.value, { ...loadSourcePrefs(orgId.value), dismissed: dismissed.value });
  }

  /** Moves local include/exclude choices into stream settings once, for a user who can write them. */
  async function migrateIncludes(write: boolean) {
    const org = orgId.value;
    if (!write || !org || isLocalPrefsMigrated(org)) return;
    // A failed load leaves no streams; marking migrated then would silently drop every choice.
    if (error.value || !rows.value.length) return;
    const live = new Set(rows.value.map((row) => row.name));
    const decided = new Set(
      rows.value
        .filter((row) => row.included === true || row.included === false)
        .map((row) => row.name),
    );
    for (const item of pendingIncludeMigrations(org, decided)) {
      // A local choice for a stream the loaded list does not contain can never succeed; skip it.
      if (!live.has(item.name)) continue;
      try {
        await ocsfPacks.saveSetting(org, item.name, {
          ...(settingOf(item.name) ?? EMPTY_SETTING),
          included: item.included,
        });
      } catch (e: any) {
        // Only a permanent 400/404 is skipped; anything else aborts unmarked so the choices retry.
        const status = e?.response?.status;
        if (status === 400 || status === 404) continue;
        return;
      }
    }
    markLocalPrefsMigrated(org);
    await query.refetch();
  }

  return {
    rows,
    streams,
    sources,
    sourceNames,
    suggestions,
    notices: computed(() => query.data.value?.notices ?? []),
    streamsReadable: computed(() => query.data.value?.streams_readable !== false),
    loading,
    classifying,
    canWrite,
    error,
    load,
    refetch: () => query.refetch(),
    include,
    exclude,
    dismiss,
    migrateIncludes,
  };
}
