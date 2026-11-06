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

import { computed, reactive, ref } from "vue";
import { MutationObserver } from "@tanstack/vue-query";
import type { Router } from "vue-router";
import { orgKey } from "@/composables/query/keys";
import { queryClient } from "@/composables/query/queryClient";
import { loadSampleDataMutation, removeSampleDataMutation } from "@/services/sample_data.queries";
import {
  SAMPLE_REMOVE_STEPS,
  SAMPLE_STEPS,
  type SampleCounts,
  type SampleLogLine,
  type SampleProgress,
  type SampleRemoveStepId,
  type SampleStepId,
} from "@/utils/sampleData/loader";
import { SAMPLE_TOUR_STEPS, resolveTourTarget } from "@/utils/sampleData/tour";

export type SampleStepStatus = "pending" | "running" | "done" | "failed";
export type SampleLoadStatus = "idle" | "loading" | "loaded" | "failed";
export type SampleRemovePhase = "idle" | "removing" | "done" | "failed";

interface TourState {
  org: string;
  index: number;
  minimized: boolean;
  /** Whether the org already held its own streams when the tour started. */
  ownData?: boolean;
}

/** A removal refused because the org's load still runs, which would bring the streams back. */
export class SampleLoadRunningError extends Error {}

const TOUR_STORAGE_KEY = "o2_sample_tour";
const WELCOME_SEEN_KEY = "o2_sample_welcome_seen";
const CLEANUP_DISMISSED_KEY = "o2_sample_cleanup_dismissed";
const ORG_FLAGS = [CLEANUP_DISMISSED_KEY] as const;

type OrgFlag = (typeof ORG_FLAGS)[number];

const status = ref<SampleLoadStatus>("idle");
const loadingOrg = ref("");
const error = ref<string | null>(null);
// the server refused the load, so only write access to the org can help
const forbidden = ref(false);
const telemetryFraction = ref(0);
const counts = reactive<SampleCounts>({ logs: 0, spans: 0, metrics: 0 });
const steps = reactive<Record<SampleStepId, SampleStepStatus>>(
  Object.fromEntries(SAMPLE_STEPS.map((id) => [id, "pending"])) as Record<
    SampleStepId,
    SampleStepStatus
  >,
);
const welcomeOpen = ref(false);
// welcome checks still deciding whether to open; other first-visit dialogs wait while any runs
const welcomeDeciding = ref(0);
const tour = ref<TourState | null>(readTour());
// a removal leaves the load status alone, so pages showing the org's data watch this to read it again
const removals = ref({ org: "", count: 0 });
// the header and the Home banner can both delete, so both stay disabled while one removal runs
const removing = ref(false);
const freshRemoveSteps = () =>
  SAMPLE_REMOVE_STEPS.map((id) => ({ id, status: "pending" as SampleStepStatus }));
const removeSteps = ref<{ id: SampleRemoveStepId; status: SampleStepStatus }[]>(freshRemoveSteps());
const removeFraction = computed(
  () =>
    removeSteps.value.filter((s) => s.status === "done" || s.status === "failed").length /
    removeSteps.value.length,
);
const removePhase = ref<SampleRemovePhase>("idle");
const removeKept = ref<string[]>([]);
const removeError = ref<unknown>(null);
const removeDialogOpen = ref(false);
// Try Again in the dialog needs the org the failed removal ran for
const removeOrg = ref("");
const flagCache = ref<Record<string, boolean>>({});

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage can be blocked; the tour then simply does not survive a reload
  }
};

// storage is not reactive, so writes go through a cache that templates can watch
const orgFlag = (flag: OrgFlag, org: string) =>
  flagCache.value[`${flag}:${org}`] ?? readStorage(`${flag}:${org}`) === "true";

const setOrgFlag = (flag: OrgFlag, org: string, on: boolean) => {
  flagCache.value = { ...flagCache.value, [`${flag}:${org}`]: on };
  writeStorage(`${flag}:${org}`, on ? "true" : null);
};

const telemetryWeight = 0.8;

const fraction = computed(() => {
  const assets = SAMPLE_STEPS.filter((s) => s !== "telemetry");
  const settled = assets.filter((s) => steps[s] === "done" || steps[s] === "failed").length;
  return (
    telemetryFraction.value * telemetryWeight + (settled / assets.length) * (1 - telemetryWeight)
  );
});

const recentLogs = ref<SampleLogLine[]>([]);

const resetProgress = () => {
  recentLogs.value = [];
  for (const id of SAMPLE_STEPS) steps[id] = "pending";
  telemetryFraction.value = 0;
  Object.assign(counts, { logs: 0, spans: 0, metrics: 0 });
};

const onProgress = (p: SampleProgress) => {
  Object.assign(counts, p.counts);
  if (p.logs?.length) recentLogs.value = p.logs;
  if (p.step === "telemetry") {
    telemetryFraction.value = p.fraction;
    steps.telemetry = p.fraction >= 1 ? "done" : "running";
    return;
  }
  steps[p.step] = p.fraction < 1 ? "running" : p.failed ? "failed" : "done";
};

// the load runs only in this tab, so a reload or a closed tab stops it part-way
const confirmLeave = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = true;
};

/** Runs the loader once per app; every surface watching this session sees the same progress. */
const start = async (org: string, ingestAllowedUptoHours?: number) => {
  // a removal in progress would be undone by the streams this load creates
  if (status.value === "loading" || removing.value) return;
  resetProgress();
  error.value = null;
  forbidden.value = false;
  loadingOrg.value = org;
  status.value = "loading";
  window.addEventListener("beforeunload", confirmLeave);
  try {
    const observer = new MutationObserver(queryClient, loadSampleDataMutation(org));
    const res = await observer.mutate({ ingestAllowedUptoHours, onProgress });
    for (const id of SAMPLE_STEPS) {
      if (id !== "telemetry") steps[id] = res.failedSteps.includes(id) ? "failed" : "done";
    }
    status.value = "loaded";
    return res;
  } catch (e: any) {
    // the mutation expires the org's queries on success only, and a failed load can leave sample streams behind
    void queryClient.invalidateQueries({ queryKey: orgKey(org) });
    steps.telemetry = "failed";
    error.value = e?.response?.data?.message ?? e?.message ?? "";
    forbidden.value = e?.response?.status === 403;
    status.value = "failed";
    return undefined;
  } finally {
    window.removeEventListener("beforeunload", confirmLeave);
  }
};

const remove = async (org: string): Promise<string[]> => {
  if (removing.value) return [];
  // the running load would recreate the streams and mark the org loaded again
  if (status.value === "loading" && loadingOrg.value === org) {
    throw new SampleLoadRunningError("Sample data is still loading");
  }
  removing.value = true;
  removeSteps.value = freshRemoveSteps();
  try {
    const observer = new MutationObserver(queryClient, removeSampleDataMutation(org));
    const keptFunctions = await observer.mutate({
      onStep: (id, stepStatus) => {
        const row = removeSteps.value.find((s) => s.id === id);
        if (row) row.status = stepStatus;
      },
    });
    removals.value = { org, count: removals.value.count + 1 };
    // the progress belongs to the last load's org; a load running elsewhere keeps it
    if (loadingOrg.value === org) {
      resetProgress();
      status.value = "idle";
    }
    for (const flag of ORG_FLAGS) setOrgFlag(flag, org, false);
    if (tour.value?.org === org) stopTour();
    return keptFunctions;
  } finally {
    removing.value = false;
  }
};

/** Removes with its progress on screen; never throws, the outcome is in removePhase. */
const removeInDialog = async (org: string) => {
  if (removePhase.value === "removing" || removing.value) return;
  removeDialogOpen.value = true;
  removeOrg.value = org;
  removePhase.value = "removing";
  removeKept.value = [];
  removeError.value = null;
  try {
    removeKept.value = await remove(org);
    removePhase.value = "done";
  } catch (e) {
    removeError.value = e;
    removePhase.value = "failed";
  }
};

const closeRemoveDialog = () => {
  removeDialogOpen.value = false;
  if (removePhase.value === "done" || removePhase.value === "failed") {
    removePhase.value = "idle";
    removeSteps.value = freshRemoveSteps();
    removeKept.value = [];
    removeError.value = null;
  }
};

const persistTour = () =>
  writeStorage(TOUR_STORAGE_KEY, tour.value ? JSON.stringify(tour.value) : null);

const startTour = (org: string, index = 0) => {
  tour.value = { org, index, minimized: false };
  welcomeOpen.value = false;
  persistTour();
};

/** Starts the tour and opens its first chapter, unless the user closed it, moved on or switched org meanwhile. */
const startTourAndShow = async (
  org: string,
  selectedOrg: () => string,
  router: Pick<Router, "push">,
) => {
  const from = selectedOrg();
  startTour(org);
  try {
    const to = await resolveTourTarget(org, SAMPLE_TOUR_STEPS[0].id);
    if (selectedOrg() === from && tour.value?.org === org && tour.value.index === 0) {
      await router.push(to);
    }
  } catch {
    // a redundant navigation to the page already open is fine
  }
};

const stopTour = () => {
  tour.value = null;
  persistTour();
};

const setTourIndex = (index: number) => {
  if (!tour.value) return;
  const last = SAMPLE_TOUR_STEPS.length;
  const next = Math.max(0, Math.min(last, index));
  tour.value = { ...tour.value, index: next, minimized: false };
  persistTour();
};

const setTourOwnData = (ownData: boolean) => {
  if (!tour.value || tour.value.ownData !== undefined) return;
  tour.value = { ...tour.value, ownData };
  persistTour();
};

const setTourMinimized = (minimized: boolean) => {
  if (!tour.value) return;
  tour.value = { ...tour.value, minimized };
  persistTour();
};

const welcomeSeen = (org: string) => readStorage(`${WELCOME_SEEN_KEY}:${org}`) === "true";
const markWelcomeSeen = (org: string) => writeStorage(`${WELCOME_SEEN_KEY}:${org}`, "true");

function readTour(): TourState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed.org === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** One app-wide session for loading sample data and walking its guided tour. */
export const useSampleDataSession = () => ({
  status,
  loadingOrg,
  error,
  forbidden,
  counts,
  recentLogs,
  steps,
  fraction,
  welcomeOpen,
  welcomeDeciding,
  tour,
  removals,
  removing,
  start,
  remove,
  removeSteps,
  removeFraction,
  removePhase,
  removeKept,
  removeError,
  removeDialogOpen,
  removeOrg,
  removeInDialog,
  closeRemoveDialog,
  startTour,
  startTourAndShow,
  stopTour,
  setTourIndex,
  setTourMinimized,
  setTourOwnData,
  welcomeSeen,
  markWelcomeSeen,
  cleanupDismissed: (org: string) => orgFlag(CLEANUP_DISMISSED_KEY, org),
  dismissCleanup: (org: string) => setOrgFlag(CLEANUP_DISMISSED_KEY, org, true),
  openWelcome: () => (welcomeOpen.value = true),
  /** Starts a load with its progress on screen in the welcome dialog. */
  loadInDialog: (org: string, ingestAllowedUptoHours?: number) => {
    if (removing.value) return Promise.resolve(undefined);
    markWelcomeSeen(org);
    welcomeOpen.value = true;
    return start(org, ingestAllowedUptoHours);
  },
  closeWelcome: () => (welcomeOpen.value = false),
});
