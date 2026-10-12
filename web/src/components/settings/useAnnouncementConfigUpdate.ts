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

import { computed } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { isEqual } from "lodash-es";
import { useStore } from "vuex";

import { notifyAnnouncementsChanged } from "@/composables/useAnnouncementBanners";
import {
  announcementConfigQuery,
  saveAnnouncementConfigMutation,
  type AnnouncementConfig,
} from "@/services/announcements.queries";
import { parseDurationMs } from "./announcementDrafts";

/** Thrown by a change when the part of the config it edits moved since the page loaded it. */
export class AnnouncementConflictError extends Error {}

/** Saves that keep losing the race to other saves give up rather than retry forever. */
const MAX_SAVE_ATTEMPTS = 3;

/** How far ahead of this browser a server pin can plausibly be anchored, for clock skew. */
const PIN_ANCHOR_SLACK_MS = 5 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `stored.ends_at` is where the server would have pinned `original`'s duration. */
const isPinnedEnd = (stored: Record<string, unknown>, original: Record<string, unknown>) => {
  const span = parseDurationMs(String(original.duration));
  const anchor = Date.parse(String(stored.ends_at)) - (span ?? NaN);
  if (Number.isNaN(anchor)) return false;
  if (typeof original.starts_at === "string") {
    return Math.abs(anchor - Date.parse(original.starts_at)) < 1000;
  }
  // Unstarted, the pin is anchored to an unknown save time; only an anchor in the future is provably not a pin.
  return anchor <= Date.now() + PIN_ANCHOR_SLACK_MS;
};

/** Whether `stored` is `original` with its `duration` pinned to an `ends_at`, as every save does. */
const isPinnedFrom = (stored: unknown, original: unknown) => {
  if (!isRecord(stored) || !isRecord(original)) return false;
  if (typeof original.duration !== "string" || "duration" in stored) return false;
  if (typeof stored.ends_at !== "string" || !isPinnedEnd(stored, original)) return false;

  const { duration: _duration, ...authored } = original;
  const { ends_at: _endsAt, ...pinned } = stored;
  return isEqual(pinned, authored);
};

/** Same stored banner, tolerating the server's own duration pinning so a save by this page is not a conflict. */
export const sameAuthored = (stored: unknown, original: unknown) =>
  stored !== undefined && (isEqual(stored, original) || isPinnedFrom(stored, original));

const isRevisionConflict = (error: any) => error?.response?.status === 409;

/** Read-modify-write of the whole stored config; the server refuses a write based on a stale read, which is re-read and re-applied. */
export function useAnnouncementConfigUpdate() {
  const store = useStore();
  const queryClient = useQueryClient();
  const metaOrg = computed<string>(() => store.state.zoConfig?.meta_org ?? "");
  const saveConfig = useMutation(() => saveAnnouncementConfigMutation(metaOrg.value));

  const update = async (change: (latest: AnnouncementConfig) => AnnouncementConfig) => {
    for (let attempt = 1; ; attempt++) {
      const latest = await queryClient.fetchQuery({
        ...announcementConfigQuery(metaOrg.value),
        staleTime: 0,
      });
      try {
        await saveConfig.mutateAsync({ ...change(latest), revision: latest.revision });
        break;
      } catch (error) {
        if (!isRevisionConflict(error)) throw error;
        if (attempt >= MAX_SAVE_ATTEMPTS) throw new AnnouncementConflictError();
      }
    }
    notifyAnnouncementsChanged();
  };

  return { update, isPending: saveConfig.isPending };
}
