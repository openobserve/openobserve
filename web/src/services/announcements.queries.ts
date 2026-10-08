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
import announcements from "./announcements";
import { announcementKeys } from "./announcements.querykeys";

/** The authored config, exactly as stored. Read from the meta org only. */
export interface AnnouncementConfig {
  banners: Record<string, unknown>[];
  styles: Record<string, unknown>[];
  /** Keys this UI does not edit, written back untouched. */
  [key: string]: unknown;
}

export const announcementConfigQuery = (org: string) =>
  queryOptions({
    queryKey: announcementKeys.config(org),
    queryFn: async (): Promise<AnnouncementConfig> => {
      const data = (await announcements.getConfig(org)).data ?? {};
      return {
        ...data,
        banners: Array.isArray(data.banners) ? data.banners : [],
        styles: Array.isArray(data.styles) ? data.styles : [],
      };
    },
    staleTime: NORMAL_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const saveAnnouncementConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: (config: AnnouncementConfig) => announcements.setConfig(org, config),
    // Callers show the server's message, which names the offending banner index and field.
    meta: { invalidates: [announcementKeys.all(org)], silentError: true },
  });
