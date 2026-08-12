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

import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

const settings = {
  createLogo: (org_identifier: string, formData: any, theme: string = "light") => {
    const url: string = `/api/${org_identifier}/settings/logo?theme=${theme}`;
    const headers = {
      "Content-Type": "multipart/form-data",
    };
    return http(headers).post(url, formData);
  },
  deleteLogo: (org_identifier: string, theme: string = "light") => {
    return http().delete(`/api/${org_identifier}/settings/logo?theme=${theme}`);
  },
  updateCustomText: (org_identifier: string, key: string, value: string) => {
    return http().post(`/api/${org_identifier}/settings/logo/text`, value);
  },

  // Settings v2 API - multi-level settings (system -> org -> user)

  /**
   * Get a resolved setting (checks user -> org -> system levels)
   */
  getSetting: (org_identifier: string, key: string, user_id?: string) => {
    let url = `/api/${org_identifier}/settings/v2/${key}`;
    if (user_id) {
      url += `?user_id=${encodeURIComponent(user_id)}`;
    }
    return http().get(url);
  },

  /**
   * List all resolved settings for an org/user
   */
  listSettings: (org_identifier: string, user_id?: string, category?: string) => {
    const params = new URLSearchParams();
    if (user_id) params.append("user_id", user_id);
    if (category) params.append("category", category);
    const queryString = params.toString();
    const url = `/api/${org_identifier}/settings/v2${queryString ? "?" + queryString : ""}`;
    return http().get(url);
  },

  /**
   * Set an org-level setting
   */
  setOrgSetting: (
    org_identifier: string,
    setting_key: string,
    setting_value: any,
    setting_category?: string,
    description?: string,
  ) => {
    const payload: any = {
      setting_key,
      setting_value,
    };
    if (setting_category) payload.setting_category = setting_category;
    if (description) payload.description = description;
    return http().post(`/api/${org_identifier}/settings/v2`, payload);
  },

  /**
   * Set a user-level setting
   */
  setUserSetting: (
    org_identifier: string,
    user_id: string,
    setting_key: string,
    setting_value: any,
    setting_category?: string,
    description?: string,
  ) => {
    const payload: any = {
      setting_key,
      setting_value,
    };
    if (setting_category) payload.setting_category = setting_category;
    if (description) payload.description = description;
    return http().post(
      `/api/${org_identifier}/settings/v2/user/${encodeURIComponent(user_id)}`,
      payload,
    );
  },

  /**
   * Delete an org-level setting
   */
  deleteOrgSetting: (org_identifier: string, key: string) => {
    return http().delete(`/api/${org_identifier}/settings/v2/${key}`);
  },

  /**
   * Delete a user-level setting
   */
  deleteUserSetting: (org_identifier: string, user_id: string, key: string) => {
    return http().delete(
      `/api/${org_identifier}/settings/v2/user/${encodeURIComponent(user_id)}/${key}`,
    );
  },
};

export default settings;

/**
 * Resolved settings — the store behind favourite dashboards and the pinned home
 * dashboard. Both are read on nearly every Dashboards mount and gate what paints
 * first, so they persist. `userId` is in the key because user-scoped settings
 * resolve differently per user and two users share a browser profile.
 */
export const settingQuery = defineQuery<[key: string, userId?: string], unknown>({
  key: (key, userId) => ["settings", "setting", key, userId ?? "__org__"],
  fetch: async (org, key, userId) => {
    try {
      return (await settings.getSetting(org, key, userId)).data?.setting_value ?? null;
    } catch (e: any) {
      // "Never set" is a normal state — cache the null so an unset favourites
      // list stops re-requesting on every mount.
      if (e?.response?.status === 404) return null;
      throw e;
    }
  },
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  persister: localStoragePersister,
  scope: ["settings", "setting"],
});
