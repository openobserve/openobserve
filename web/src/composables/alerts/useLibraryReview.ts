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

import { ref } from "vue";
import { useStore } from "vuex";

import {
  labelMatchers,
  mapBounded,
  REVIEW_CONCURRENCY,
  reviewDestination,
  reviewRequires,
  reviewThreshold,
  userEmailDestination,
  type ReviewRoutes,
} from "@/components/alertLibrary/libraryReview";
import { NOISY_FIRE_LIMIT } from "@/components/alertLibrary/libraryQuickAdd";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import {
  ORG_DEFAULT_DESTINATION_KEY,
  orgDefaultDestinationOf,
} from "@/composables/alerts/useEmailMeDestination";
import { useLibraryLabelCheck, type LabelVerdict } from "@/composables/alerts/useLibraryLabelCheck";
import { isAnomalyRule, useLibraryQuickAdd } from "@/composables/alerts/useLibraryQuickAdd";
import { queryClient } from "@/composables/query/queryClient";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { settingQuery } from "@/services/settings.queries";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

// A failed check claims nothing either way, so it stays tickable but is never shown as ready.
const ROW_STATE: Record<LabelVerdict["state"], ReviewRowState> = {
  ok: "ready",
  missing: "needsData",
  unknown: "unknown",
};

/** Where a reviewed rule stands: loading, runnable, missing data, label check failed, or its file failed to load. */
export type ReviewRowState = "loading" | "ready" | "needsData" | "unknown" | "failed";

/** What Enable did to a row. */
export type ReviewResult = "added" | "paused" | "failed";

/** One rule in a pack review. */
export interface ReviewRow {
  id: string;
  entry: AlertLibraryEntry;
  state: ReviewRowState;
  /** "job hadoop-namenode" when the label check found it missing. */
  needsData: string;
  /** The streams and label values the rule reads. */
  requires: string;
  threshold: string;
  /** Yesterday's fires; null when not estimated, undefined while loading. */
  fires?: number | null;
  anomaly: boolean;
  result?: ReviewResult;
  error?: string;
}

export interface ReviewDeps {
  /** A rule from the review now has an alert in this org. */
  onAdded: (entryId: string) => void;
}

const streamsOf = (entry: AlertLibraryEntry): string[] =>
  Array.isArray(entry.required_streams) && entry.required_streams.length > 0
    ? entry.required_streams
    : [entry.stream];

const promqlOf = (file: AlertLibraryFile): string => {
  const query = (file?.query_condition ?? {}) as Record<string, unknown>;
  return query.type === "promql" && typeof query.promql === "string" ? query.promql : "";
};

const serverMessage = (error: any): string =>
  String(error?.response?.data?.message ?? error?.response?.data?.error ?? "");

/** A row Enable may install: loaded, not known to miss data, and not already added. */
export function isSelectable(row: ReviewRow): boolean {
  return (
    (row.state === "ready" || row.state === "unknown") &&
    row.result !== "added" &&
    row.result !== "paused"
  );
}

/** A pack review: per-rule files, label checks and estimates, then a sequential Enable. */
export function useLibraryReview(deps: ReviewDeps) {
  const store = useStore();
  const { loadAlertFile } = useAlertLibrary();
  const { check, needsData } = useLibraryLabelCheck();
  const { install, estimateFires } = useLibraryQuickAdd({
    onAdded: () => undefined,
    onRemoved: () => undefined,
  });
  const org = (): string => store.state.selectedOrganization?.identifier ?? "";

  const rows = ref<ReviewRow[]>([]);
  const selectedIds = ref<string[]>([]);
  const loading = ref(false);
  const enabling = ref(false);
  // A pack opened after this one must not receive its late answers.
  let generation = 0;

  const patch = (id: string, change: Partial<ReviewRow>) => {
    rows.value = rows.value.map((row) => (row.id === id ? { ...row, ...change } : row));
  };

  const loadRow = async (entry: AlertLibraryEntry, run: number) => {
    try {
      const file = await loadAlertFile(entry);
      const anomaly = isAnomalyRule(entry, file);
      const [verdict, fires] = await Promise.all([
        check(entry, file),
        anomaly ? Promise.resolve(null) : estimateFires(file),
      ]);
      if (run !== generation) return;
      patch(entry.id, {
        state: ROW_STATE[verdict.state],
        needsData: needsData(entry),
        requires: reviewRequires(streamsOf(entry), labelMatchers(promqlOf(file))),
        threshold: anomaly ? "" : reviewThreshold(file),
        fires,
        anomaly,
      });
    } catch {
      if (run === generation) patch(entry.id, { state: "failed", fires: null });
    }
  };

  /** Loads the pack's rules, a few files at a time; nothing is fetched before this. */
  const load = async (entries: readonly AlertLibraryEntry[]): Promise<void> => {
    generation += 1;
    const run = generation;
    rows.value = entries.map((entry) => ({
      id: entry.id,
      entry,
      state: "loading",
      needsData: needsData(entry),
      requires: reviewRequires(streamsOf(entry), []),
      threshold: "",
      anomaly: false,
    }));
    selectedIds.value = [];
    loading.value = true;
    await mapBounded(entries, REVIEW_CONCURRENCY, (entry) => loadRow(entry, run));
    if (run !== generation) return;
    loading.value = false;
    selectedIds.value = rows.value.filter(isSelectable).map((row) => row.id);
  };

  const routes = async (): Promise<ReviewRoutes> => {
    try {
      const [list, setting] = await Promise.all([
        queryClient.fetchQuery(destinationsQuery(org(), "alert")),
        queryClient.fetchQuery(settingQuery(org(), ORG_DEFAULT_DESTINATION_KEY)).catch(() => null),
      ]);
      const name = orgDefaultDestinationOf(setting);
      const exists = !!name && list.some((destination: any) => destination?.name === name);
      return {
        orgDefault: exists ? (name as string) : "",
        email: userEmailDestination(list, String(store.state.userInfo?.email ?? "")),
      };
    } catch {
      return { orgDefault: "", email: "" };
    }
  };

  /** Installs the ticked rules one after another; a failure stays ticked so Enable retries it. */
  const enable = async (): Promise<ReviewRow[]> => {
    if (enabling.value) return [];
    enabling.value = true;
    const run = generation;
    try {
      const picked = rows.value.filter((row) => selectedIds.value.includes(row.id));
      const route = await routes();
      for (const row of picked) {
        if (run !== generation) break;
        try {
          await install(row.entry, {
            destination: reviewDestination(row.entry.severity, route),
            fires: row.anomaly ? null : (row.fires ?? null),
          });
          const paused = !row.anomaly && (row.fires ?? 0) > NOISY_FIRE_LIMIT;
          patch(row.id, { result: paused ? "paused" : "added", error: undefined });
          selectedIds.value = selectedIds.value.filter((id) => id !== row.id);
          deps.onAdded(row.id);
        } catch (error) {
          patch(row.id, { result: "failed", error: serverMessage(error) });
        }
      }
      return rows.value.filter((row) => picked.some((item) => item.id === row.id));
    } finally {
      enabling.value = false;
    }
  };

  return { rows, selectedIds, loading, enabling, load, enable };
}
