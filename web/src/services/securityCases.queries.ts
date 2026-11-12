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
import { orgKey } from "@/composables/query/keys";
import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import securityCases, { type CaseRef, type CaseSettings, type PromoteEvent } from "./securityCases";
import incidents, { type Incident } from "./incidents";

export const securityCaseKeys = {
  all: (org: string) => orgKey(org, "security", "cases"),
  byAlert: (org: string, alertIds: string[]) =>
    orgKey(org, "security", "cases", "by_alert", [...alertIds].sort().join(",")),
  settings: (org: string) => orgKey(org, "security", "cases", "settings"),
  open: (org: string) => orgKey(org, "security", "cases", "open"),
};

/** Most open cases offered when adding evidence; newer ones come first. */
export const MAX_ATTACHABLE_CASES = 100;

/** Unresolved security cases, newest activity first, for "add to case". */
export const openCasesQuery = (org: string) =>
  queryOptions({
    queryKey: securityCaseKeys.open(org),
    queryFn: async (): Promise<Incident[]> => {
      const res = await incidents.list(org, undefined, MAX_ATTACHABLE_CASES, 0, undefined, true);
      return (res.data?.incidents ?? []).filter((c) => c.status !== "resolved");
    },
    staleTime: LIVE_STALE_TIME,
  });

/** Opens a case from an event, or adds the event to `caseId`. */
export const promoteEventMutation = (org: string) =>
  mutationOptions({
    mutationFn: async ({ event, caseId }: { event: PromoteEvent; caseId?: string }) =>
      (await securityCases.promoteEvent(org, event, caseId)).data,
    meta: { invalidates: [securityCaseKeys.all(org)], silentError: true },
  });

/** The open case each detection fires into; detections without one are absent. */
export const caseLookupQuery = (org: string, alertIds: string[]) =>
  queryOptions({
    queryKey: securityCaseKeys.byAlert(org, alertIds),
    queryFn: async (): Promise<Record<string, CaseRef>> =>
      alertIds.length ? ((await securityCases.lookup(org, alertIds)).data?.cases ?? {}) : {},
    staleTime: LIVE_STALE_TIME,
  });

/** How long a quiet case stays open and how firings group into cases. */
export const caseSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: securityCaseKeys.settings(org),
    queryFn: async (): Promise<CaseSettings> => (await securityCases.getSettings(org)).data,
    staleTime: MEDIUM_STALE_TIME,
  });

/** The dialog shows the server's refusal itself, so the default error toast stays quiet. */
export const saveCaseSettingsMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (settings: CaseSettings) =>
      (await securityCases.updateSettings(org, settings)).data,
    meta: { invalidates: [securityCaseKeys.settings(org)], silentError: true },
  });
