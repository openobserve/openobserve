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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import alertCalibration, {
  httpStatus,
  isAbort,
  type AlertCalibrationConfig,
  type AlertCalibrationStatus,
  type UpdateAlertCalibrationConfig,
} from "./alert_calibration";
import { alertCalibrationKeys } from "./alert_calibration.querykeys";
import { autoobserveKeys } from "./autoobserve.querykeys";
import {
  LIST_MAX_PAGES,
  LIST_PAGE,
  type DismissalView,
  type DismissBody,
} from "@/components/alert_calibration/dismissals";
import {
  latestEmission,
  type DigestRecord,
  type RunRow,
  type SkipRecord,
} from "@/components/alert_calibration/digests";
import { parseHeadroom, type Headroom } from "@/components/alert_calibration/headroom";

/** Past the longest calibration window plus a missed run or two (P7c-S9). */
const HEADROOM_LOOKBACK_DAYS = 35;
const DAY_MICROS = 86_400_000_000;

/** Every active dismissal the reader can see, up to the client's page cap. */
export interface ActiveDismissals {
  items: DismissalView[];
  /** The full visible count, so it can exceed `items` once the cap is reached. */
  total: number;
  capped: boolean;
}

/** One alert's quiet note from the newest run, with what the card needs to date it. */
export interface AlertHeadroom {
  skip: SkipRecord;
  headroom: Headroom;
  runWindow: { start: number; end: number };
  emittedAt: number;
}

/** `null` until the org's first save: the server answers 404 for an org with no config row. */
export const alertCalibrationConfigQuery = (org: string) =>
  queryOptions({
    queryKey: alertCalibrationKeys.config(org),
    queryFn: async (): Promise<AlertCalibrationConfig | null> => {
      try {
        return (await alertCalibration.getConfig(org)).data;
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
    staleTime: NORMAL_STALE_TIME,
  });

/** `null` while the org has no config, since there is no run to report on. */
export const alertCalibrationStatusQuery = (org: string) =>
  queryOptions({
    queryKey: alertCalibrationKeys.status(org),
    queryFn: async (): Promise<AlertCalibrationStatus | null> => {
      try {
        return (await alertCalibration.getStatus(org)).data;
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
    staleTime: NORMAL_STALE_TIME,
  });

/** Optional information, so every gap and error is `null` and a 403 records no access-boundary entry (P7b-D6). */
export const alertHeadroomQuery = (org: string, alertId: string) =>
  queryOptions({
    queryKey: alertCalibrationKeys.headroom(org, alertId),
    queryFn: async ({ signal }): Promise<AlertHeadroom | null> => {
      const quiet = { silentForbidden: true };
      try {
        const now = Date.now() * 1000;
        const [run] = await alertCalibration.readDigests<RunRow>(
          org,
          "",
          { start_time: now - HEADROOM_LOOKBACK_DAYS * DAY_MICROS, end_time: now, size: 1 },
          signal,
          quiet,
        );
        if (!run) return null;
        const records = await alertCalibration.readDigests<DigestRecord>(
          org,
          "/records",
          {
            window_start: run.window_start,
            window_end: run.window_end,
            kind: "skip",
            rule_id: "silent",
            alert_id: alertId,
            size: 5,
          },
          signal,
          quiet,
        );
        // A newer emission without this alert's skip must not fall back to an older emission's.
        const emission = records.filter((r) => r._timestamp === run.emitted_at);
        const skip = latestEmission(emission).skips.find((s) => s.alert_id === alertId);
        const headroom = parseHeadroom(skip?.skip_detail);
        if (!skip || !headroom) return null;
        return {
          skip,
          headroom,
          runWindow: { start: run.window_start, end: run.window_end },
          emittedAt: skip._timestamp,
        };
      } catch (error) {
        if (isAbort(error)) throw error;
        return null;
      }
    },
    staleTime: NORMAL_STALE_TIME,
  });

export const updateAlertCalibrationConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: UpdateAlertCalibrationConfig) =>
      (await alertCalibration.updateConfig(org, body)).data,
    // The settings form renders its own toasts.
    meta: { invalidates: [alertCalibrationKeys.all(org)], silentError: true },
  });

export const requestAlertCalibrationRunMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => alertCalibration.requestRun(org),
    // The caller says what happens next; a run only changes the digest stream, which is never cached.
    meta: { silentError: true },
  });

/** Pages the active list to the cap; `total` comes from the first page, which counts every visible row. */
export const activeDismissalsQuery = (org: string) =>
  queryOptions({
    queryKey: alertCalibrationKeys.dismissals(org),
    queryFn: async ({ signal }): Promise<ActiveDismissals> => {
      const items: DismissalView[] = [];
      let total = 0;
      let cursor: string | null = null;
      for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
        const res = await alertCalibration.listDismissals(
          org,
          { state: "active", limit: LIST_PAGE, ...(cursor ? { cursor } : {}) },
          signal,
        );
        if (page === 0) total = res.data.total;
        items.push(...res.data.items);
        cursor = res.data.next_cursor;
        if (!cursor) return { items, total, capped: false };
      }
      return { items, total, capped: true };
    },
    // A board folds findings by this list, so each mount reads it fresh.
    staleTime: 0,
  });

/** Resolves only once the list refetch lands, so nothing folds before the server and the list agree. */
export const dismissFindingMutation = (org: string) =>
  mutationOptions({
    mutationFn: async ({ findingId, body }: { findingId: string; body: DismissBody }) =>
      (await alertCalibration.dismissFinding(org, findingId, body)).data,
    meta: {
      // The AutoObserve rail lists the same findings, so both surfaces drop or restore it at once.
      invalidates: [alertCalibrationKeys.dismissals(org), autoobserveKeys.suggestions(org)],
      awaitInvalidation: true,
      silentError: true,
    },
  });

export const reopenDismissalMutation = (org: string) =>
  mutationOptions({
    mutationFn: async ({ id, revision }: { id: string; revision: number }) =>
      (await alertCalibration.reopenDismissal(org, id, revision)).data,
    meta: {
      invalidates: [alertCalibrationKeys.dismissals(org), autoobserveKeys.suggestions(org)],
      awaitInvalidation: true,
      silentError: true,
    },
  });
