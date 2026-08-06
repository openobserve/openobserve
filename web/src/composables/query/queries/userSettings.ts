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
 * Resolved settings (`/settings/v2/{key}`) — the store behind the favourite
 * dashboards and the pinned home dashboard.
 *
 * Both are read on nearly every Dashboards mount and on MainLayout boot, and
 * both gate what the page renders first, so they are persisted: on a reload the
 * favourites rail and the home button paint without waiting for a request.
 */

import settingsService from "@/services/settings";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const settingQueryOptions = (org: string, key: string, userId?: string) => ({
  queryKey: qk.settings.setting(org, key, userId),
  queryFn: async (): Promise<unknown> => {
    try {
      return (await settingsService.getSetting(org, key, userId)).data?.setting_value ?? null;
    } catch (e: any) {
      // "Never set" is a normal state, not an error — cache the null so an
      // unset favourites list stops re-requesting on every mount.
      if (e?.response?.status === 404) return null;
      throw e;
    }
  },
  ...tierOptions("ORG_CONFIG"),
});

export const fetchSetting = <T = unknown>(org: string, key: string, userId?: string): Promise<T> =>
  queryClient.fetchQuery(settingQueryOptions(org, key, userId)) as Promise<T>;

export const refetchSetting = <T = unknown>(
  org: string,
  key: string,
  userId?: string,
): Promise<T> =>
  queryClient.fetchQuery({
    ...settingQueryOptions(org, key, userId),
    staleTime: 0,
  }) as Promise<T>;

/**
 * Push a value the caller already applied optimistically into the cache, so the
 * next read agrees with the screen without a round trip.
 */
export const primeSetting = (org: string, key: string, value: unknown, userId?: string): void => {
  queryClient.setQueryData(qk.settings.setting(org, key, userId), value);
};

export const invalidateSetting = (org: string, key: string, userId?: string) =>
  queryClient.invalidateQueries({ queryKey: qk.settings.setting(org, key, userId) });
