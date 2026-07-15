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

/**
 * Metrics Saved Views — named snapshots of the explorer's filter state + pinned
 * metrics, persisted through the SAME `/savedviews` API the Logs page uses (the
 * `data` field is opaque, so a Metrics snapshot needs no backend change).
 *
 * The snapshot is the serialized `ExplorerFilterState` (Sets flattened to arrays
 * for JSON) plus the pinned metric names. A view deliberately does NOT capture
 * the time range — it opens against live "now" — nor the transient
 * `showFavoritesOnly` quick filter. Rehydrate maps the snapshot back onto the
 * caller's grid state via the callbacks it provides.
 */
import { ref } from "vue";
import { useStore } from "vuex";
import savedViewsService from "@/services/saved_views";

/** One metrics saved view, as the list/table renders it. */
export interface MetricsSavedView {
  view_id: string;
  view_name: string;
}

/** The opaque snapshot stored in a view's `data` field. */
export interface MetricsSavedViewSnapshot {
  /** `metrics` marks the record as ours so a shared `/savedviews` list can tell
   *  a Metrics view from a Logs one. */
  kind: "metrics";
  /** Serialized ExplorerFilterState — Sets already flattened to arrays. */
  filters: Record<string, any>;
  /** Pinned metric names at save time. */
  pinned: string[];
}

const isMetricsSnapshot = (data: any): data is MetricsSavedViewSnapshot =>
  !!data && data.kind === "metrics";

export default function useMetricsSavedViews() {
  const store = useStore();

  const views = ref<MetricsSavedView[]>([]);
  const loading = ref(false);
  const activeViewId = ref<string>("");

  const org = () => store.state.selectedOrganization?.identifier;

  /** Fetch the org's views, keeping only the Metrics ones (a shared list may hold
   *  Logs views too). Best-effort: a failure leaves the list empty, not broken. */
  const listViews = async (): Promise<MetricsSavedView[]> => {
    loading.value = true;
    try {
      const res = await savedViewsService.get(org());
      const raw = res?.data?.views ?? res?.data ?? [];
      views.value = (Array.isArray(raw) ? raw : [])
        .filter((v: any) => isMetricsSnapshot(v?.payload) || isMetricsSnapshot(v?.data))
        .map((v: any) => ({ view_id: v.view_id, view_name: v.view_name }));
      return views.value;
    } catch {
      views.value = [];
      return [];
    } finally {
      loading.value = false;
    }
  };

  /** Create a new view from the current snapshot. Returns the new view_id. */
  const createView = async (
    name: string,
    snapshot: MetricsSavedViewSnapshot,
  ): Promise<string | null> => {
    const res = await savedViewsService.post(org(), {
      view_name: name,
      data: snapshot,
    });
    const id = res?.data?.view_id ?? "";
    if (id) {
      views.value.push({ view_id: id, view_name: name });
      activeViewId.value = id;
    }
    return id || null;
  };

  /** Overwrite an existing view with the current snapshot (and optional rename). */
  const updateView = async (
    viewId: string,
    name: string,
    snapshot: MetricsSavedViewSnapshot,
  ): Promise<void> => {
    await savedViewsService.put(org(), viewId, {
      view_name: name,
      data: snapshot,
    });
    const existing = views.value.find((v) => v.view_id === viewId);
    if (existing) existing.view_name = name;
    activeViewId.value = viewId;
  };

  const deleteView = async (viewId: string): Promise<void> => {
    await savedViewsService.delete(org(), viewId);
    views.value = views.value.filter((v) => v.view_id !== viewId);
    if (activeViewId.value === viewId) activeViewId.value = "";
  };

  /** Fetch a view's snapshot so the caller can rehydrate its grid state. */
  const getViewSnapshot = async (
    viewId: string,
  ): Promise<MetricsSavedViewSnapshot | null> => {
    const res = await savedViewsService.getViewDetail(org(), viewId);
    const data = res?.data?.data ?? res?.data;
    return isMetricsSnapshot(data) ? data : null;
  };

  return {
    views,
    loading,
    activeViewId,
    listViews,
    createView,
    updateView,
    deleteView,
    getViewSnapshot,
  };
}
