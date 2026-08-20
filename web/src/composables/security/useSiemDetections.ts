// Copyright 2026 OpenObserve Inc.
//
// useSiemDetections.ts — the org's detection rules, with their SIEM metadata.
//
// Loading these is more work than it should be, for one reason: the v2 alert
// list is a summary. It carries the name, state, level and schedule, but not
// `context_attributes`, `stream_name` or `query_condition` — and everything that
// distinguishes a detection from an ordinary alert lives in those. So the list
// says what exists and a per-alert fetch says what it is.
//
// Three pages need that answer (Detections, Alerts and Cases all have to tell a
// detection from a disk-space alert), which is why it lives here rather than
// being written three times with three different bugs.
//
// The hydration deliberately does not block: the list renders immediately and
// rules are identified as their fetches land. A SOC opening the page during an
// incident should see something in the first paint.

import { computed, ref, shallowRef } from "vue";

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

  async function load(orgId: string) {
    if (!orgId) return;
    loading.value = true;
    error.value = "";
    try {
      const res = await alertsService.listByFolderId(0, 1000, "name", false, "", orgId);
      const list = (res.data?.list ?? []).map((row: any) => ({
        ...row,
        id: row.alert_id ?? row.id,
      }));
      alerts.value = list;
      loading.value = false;
      await hydrate(orgId, list);
    } catch (e: any) {
      error.value = e?.response?.data?.message ?? "Failed to load detection rules";
      loading.value = false;
    }
  }

  async function hydrate(orgId: string, list: Record<string, any>[]) {
    const targets = list.filter((row) => row.id).slice(0, HYDRATE_LIMIT);
    unchecked.value = Math.max(0, list.length - targets.length);
    if (!targets.length) return;

    hydrating.value = true;
    const queue = [...targets];
    const merged = new Map<string, Record<string, any>>();
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        try {
          const res = await alertsService.get_by_alert_id(orgId, row.id);
          merged.set(row.id, { ...row, ...(res.data ?? {}), id: row.id });
        } catch {
          // One unreadable alert must not stop the rest from being identified.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(HYDRATE_CONCURRENCY, targets.length) }, worker),
    );
    alerts.value = alerts.value.map((row) => merged.get(row.id) ?? row);
    hydrating.value = false;
  }

  /** Applies a local change (an enable toggle) without a full reload. */
  function patch(id: string, changes: Record<string, any>) {
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
