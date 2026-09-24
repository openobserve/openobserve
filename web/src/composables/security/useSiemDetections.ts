// Copyright 2026 OpenObserve Inc.
//
// useSiemDetections.ts — the org's alerts with SIEM metadata. The list API is a
// summary, so each alert is fetched (bounded, in batches) to read its Sigma metadata.

import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import alertsService from "@/services/alerts";
import type { DetectionMeta } from "@/utils/security/detection";
import { detectionMetaOf } from "@/utils/security/detection";

export interface DetectionRow {
  alert: Record<string, any>;
  meta: DetectionMeta;
}

/**
 * Detections number in the tens in practice. This bounds the pathological case
 * of an org with thousands of ordinary alerts, where scanning all of them to
 * find the handful of SIEM rules is the wrong approach anyway.
 */
const HYDRATE_LIMIT = 200;
const HYDRATE_CONCURRENCY = 6;

export function useSiemDetections() {
  const { t } = useI18n();
  const alerts = shallowRef<Record<string, any>[]>([]);
  const loading = ref(false);
  const hydrating = ref(false);
  const error = ref("");
  /** Alerts past the limit, never checked for SIEM metadata. Reported, not hidden. */
  const unchecked = ref(0);

  const rows = computed<DetectionRow[]>(() =>
    alerts.value.map((alert) => ({ alert, meta: detectionMetaOf(alert) })),
  );

  const siemRows = computed(() => rows.value.filter((row) => row.meta.isSiem));

  /** Detection metadata by alert name, which is the only key alert history carries. */
  const byName = computed(() => {
    const index = new Map<string, DetectionRow>();
    for (const row of siemRows.value) {
      if (row.alert.name) index.set(String(row.alert.name), row);
    }
    return index;
  });

  // Each load bumps this; an older load's results are dropped.
  let loadSeq = 0;
  // Local edits (a toggle) made while hydration is in flight win over the
  // GETs that hydration started before them.
  let patches = new Map<string, Record<string, any>>();

  async function load(orgId: string) {
    if (!orgId) return;
    const seq = ++loadSeq;
    patches = new Map();
    loading.value = true;
    // An older hydration may be mid-flight; it no longer owns these flags.
    hydrating.value = false;
    unchecked.value = 0;
    error.value = "";
    try {
      const res = await alertsService.listByFolderId(0, 1000, "name", false, "", orgId);
      const list = (res.data?.list ?? []).map((row: any) => ({
        ...row,
        id: row.alert_id ?? row.id,
      }));
      if (seq !== loadSeq) return;
      alerts.value = list;
      loading.value = false;
      await hydrate(orgId, list, seq);
    } catch (e: any) {
      if (seq !== loadSeq) return;
      error.value = e?.response?.data?.message ?? t("siem.detections.loadError");
      loading.value = false;
    }
  }

  async function hydrate(orgId: string, list: Record<string, any>[], seq: number) {
    const targets = list.filter((row) => row.id).slice(0, HYDRATE_LIMIT);
    unchecked.value = Math.max(0, list.length - targets.length);
    if (!targets.length) return;

    hydrating.value = true;
    const queue = [...targets];
    let pending = new Map<string, Record<string, any>>();
    // Rules appear as their fetches land, a batch at a time, not all at the end.
    const flush = () => {
      if (seq !== loadSeq || !pending.size) return;
      const batch = pending;
      pending = new Map();
      alerts.value = alerts.value.map((row) => {
        const full = batch.get(row.id);
        return full ? { ...full, ...(patches.get(row.id) ?? {}) } : row;
      });
    };
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        try {
          const res = await alertsService.get_by_alert_id(orgId, row.id);
          pending.set(row.id, { ...row, ...(res.data ?? {}), id: row.id });
          if (pending.size >= HYDRATE_CONCURRENCY * 2) flush();
        } catch {
          // One unreadable alert must not stop the rest from being identified.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(HYDRATE_CONCURRENCY, targets.length) }, worker),
    );
    flush();
    if (seq === loadSeq) hydrating.value = false;
  }

  /** Applies a local change (an enable toggle) without a full reload. */
  function patch(id: string, changes: Record<string, any>) {
    patches.set(id, { ...(patches.get(id) ?? {}), ...changes });
    alerts.value = alerts.value.map((row) => (row.id === id ? { ...row, ...changes } : row));
  }

  function remove(id: string) {
    alerts.value = alerts.value.filter((row) => row.id !== id);
  }

  return {
    alerts,
    rows,
    siemRows,
    byName,
    loading,
    hydrating,
    error,
    unchecked,
    load,
    patch,
    remove,
  };
}
