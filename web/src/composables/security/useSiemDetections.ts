// Copyright 2026 OpenObserve Inc.

import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import alertsService from "@/services/alerts";
import type { DetectionMeta } from "@/utils/security/detection";
import { detectionMetaOf } from "@/utils/security/detection";

export interface DetectionRow {
  alert: Record<string, any>;
  meta: DetectionMeta;
}

/** Moving between Security pages reuses one list instead of refetching it. */
const LIST_TTL_MS = 60_000;

const listCache = new Map<string, { at: number; list: Record<string, any>[] }>();

/** Drops the cached list, so the next load refetches (after a create, toggle or delete). */
export function invalidateSiemDetections(orgId?: string) {
  if (orgId) listCache.delete(orgId);
  else listCache.clear();
}

export function useSiemDetections() {
  const { t } = useI18n();
  const alerts = shallowRef<Record<string, any>[]>([]);
  const loading = ref(false);
  const error = ref("");

  const rows = computed<DetectionRow[]>(() =>
    alerts.value.map((alert) => ({ alert, meta: detectionMetaOf(alert) })),
  );

  const siemRows = computed(() => rows.value.filter((row) => row.meta.isSiem));

  /** Detection metadata by alert name, which is the only key raw alert history carries. */
  const byName = computed(() => {
    const index = new Map<string, DetectionRow>();
    for (const row of siemRows.value) {
      if (row.alert.name) index.set(String(row.alert.name), row);
    }
    return index;
  });

  /** Detection metadata by alert id, the key the history summary uses. */
  const byId = computed(() => {
    const index = new Map<string, DetectionRow>();
    for (const row of siemRows.value) {
      if (row.alert.id) index.set(String(row.alert.id), row);
    }
    return index;
  });

  // Each load bumps this; an older load's results are dropped.
  let loadSeq = 0;
  // Only a page's first load may reuse the list; a refresh or org switch always refetches.
  let loadedOnce = false;

  async function load(orgId: string) {
    if (!orgId) return;
    const seq = ++loadSeq;
    const cached = listCache.get(orgId);
    const reuse = !loadedOnce && cached && Date.now() - cached.at < LIST_TTL_MS;
    loadedOnce = true;
    if (reuse) {
      alerts.value = cached.list;
      loading.value = false;
      error.value = "";
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      const res = await alertsService.listByFolderId(0, 1000, "name", false, "", orgId);
      const list = (res.data?.list ?? []).map((row: any) => ({
        ...row,
        id: row.alert_id ?? row.id,
      }));
      if (seq !== loadSeq) return;
      listCache.set(orgId, { at: Date.now(), list });
      alerts.value = list;
    } catch (e: any) {
      if (seq !== loadSeq) return;
      error.value = e?.response?.data?.message ?? t("siem.detections.loadError");
    } finally {
      if (seq === loadSeq) loading.value = false;
    }
  }

  /** Fetches one alert in full (rule YAML included) and merges it into the list. */
  async function loadFull(orgId: string, id: string) {
    const current = alerts.value.find((row) => row.id === id);
    if (!orgId || !current || current.context_attributes?.sigma_yaml) return;
    try {
      const res = await alertsService.get_by_alert_id(orgId, id);
      const full = { ...current, ...(res.data ?? {}), id };
      alerts.value = alerts.value.map((row) => (row.id === id ? full : row));
    } catch {
      // The drawer still shows everything the list carried; only the YAML is missing.
    }
  }

  /** Applies a local change (an enable toggle) without a full reload. */
  function patch(id: string, changes: Record<string, any>) {
    alerts.value = alerts.value.map((row) => (row.id === id ? { ...row, ...changes } : row));
    for (const [orgId, cached] of listCache) {
      listCache.set(orgId, {
        ...cached,
        list: cached.list.map((row) => (row.id === id ? { ...row, ...changes } : row)),
      });
    }
  }

  function remove(id: string) {
    alerts.value = alerts.value.filter((row) => row.id !== id);
    invalidateSiemDetections();
  }

  return {
    alerts,
    rows,
    siemRows,
    byName,
    byId,
    loading,
    error,
    load,
    loadFull,
    patch,
    remove,
  };
}
