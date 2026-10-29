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
import { queryClient } from "@/composables/query/queryClient";
import { loadSampleDataMutation, removeSampleDataMutation } from "@/services/sample_data.queries";
import {
  SAMPLE_STEPS,
  type SampleCounts,
  type SampleLoadResult,
  type SampleProgress,
  type SampleStepId,
} from "@/utils/sampleData/loader";
import { SAMPLE_TOUR_STEPS } from "@/utils/sampleData/tour";

export type SampleStepStatus = "pending" | "running" | "done" | "failed";
export type SampleLoadStatus = "idle" | "loading" | "loaded" | "failed";

interface TourState {
  org: string;
  index: number;
  minimized: boolean;
}

const TOUR_STORAGE_KEY = "o2_sample_tour";
const WELCOME_SEEN_KEY = "o2_sample_welcome_seen";
const TOUR_DONE_KEY = "o2_sample_tour_done";
const BANNER_DISMISSED_KEY = "o2_sample_home_banner_dismissed";
const CLEANUP_DISMISSED_KEY = "o2_sample_cleanup_dismissed";
const ORG_FLAGS = [TOUR_DONE_KEY, BANNER_DISMISSED_KEY, CLEANUP_DISMISSED_KEY] as const;

type OrgFlag = (typeof ORG_FLAGS)[number];

const status = ref<SampleLoadStatus>("idle");
const loadingOrg = ref("");
const error = ref<string | null>(null);
const result = ref<SampleLoadResult>();
const telemetryFraction = ref(0);
const counts = reactive<SampleCounts>({ logs: 0, spans: 0, metrics: 0 });
const steps = reactive<Record<SampleStepId, SampleStepStatus>>(
  Object.fromEntries(SAMPLE_STEPS.map((id) => [id, "pending"])) as Record<
    SampleStepId,
    SampleStepStatus
  >,
);
const welcomeOpen = ref(false);
const tour = ref<TourState | null>(readTour());
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

const resetProgress = () => {
  for (const id of SAMPLE_STEPS) steps[id] = "pending";
  telemetryFraction.value = 0;
  Object.assign(counts, { logs: 0, spans: 0, metrics: 0 });
};

const onProgress = (p: SampleProgress) => {
  Object.assign(counts, p.counts);
  if (p.step === "telemetry") {
    telemetryFraction.value = p.fraction;
    steps.telemetry = p.fraction >= 1 ? "done" : "running";
    return;
  }
  if (p.fraction === 0) steps[p.step] = "running";
};

/** Runs the loader once per app; every surface watching this session sees the same progress. */
const start = async (org: string, ingestAllowedUptoHours?: number) => {
  if (status.value === "loading") return result.value;
  resetProgress();
  error.value = null;
  result.value = undefined;
  loadingOrg.value = org;
  status.value = "loading";
  try {
    const observer = new MutationObserver(queryClient, loadSampleDataMutation(org));
    const res = await observer.mutate({ ingestAllowedUptoHours, onProgress });
    for (const id of SAMPLE_STEPS) {
      if (id !== "telemetry") steps[id] = res.failedSteps.includes(id) ? "failed" : "done";
    }
    result.value = res;
    status.value = "loaded";
    return res;
  } catch (e: any) {
    steps.telemetry = "failed";
    error.value = e?.response?.data?.message ?? e?.message ?? "";
    status.value = "failed";
    return undefined;
  }
};

const remove = async (org: string) => {
  const observer = new MutationObserver(queryClient, removeSampleDataMutation(org));
  await observer.mutate();
  resetProgress();
  result.value = undefined;
  status.value = "idle";
  for (const flag of ORG_FLAGS) setOrgFlag(flag, org, false);
  if (tour.value?.org === org) stopTour();
};

const persistTour = () =>
  writeStorage(TOUR_STORAGE_KEY, tour.value ? JSON.stringify(tour.value) : null);

const startTour = (org: string, index = 0) => {
  tour.value = { org, index, minimized: false };
  welcomeOpen.value = false;
  persistTour();
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
  if (next === last) setOrgFlag(TOUR_DONE_KEY, tour.value.org, true);
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
  result,
  counts,
  steps,
  fraction,
  welcomeOpen,
  tour,
  start,
  remove,
  startTour,
  stopTour,
  setTourIndex,
  setTourMinimized,
  welcomeSeen,
  markWelcomeSeen,
  tourDone: (org: string) => orgFlag(TOUR_DONE_KEY, org),
  bannerDismissed: (org: string) => orgFlag(BANNER_DISMISSED_KEY, org),
  dismissBanner: (org: string) => setOrgFlag(BANNER_DISMISSED_KEY, org, true),
  cleanupDismissed: (org: string) => orgFlag(CLEANUP_DISMISSED_KEY, org),
  dismissCleanup: (org: string) => setOrgFlag(CLEANUP_DISMISSED_KEY, org, true),
  openWelcome: () => (welcomeOpen.value = true),
  closeWelcome: () => (welcomeOpen.value = false),
});
