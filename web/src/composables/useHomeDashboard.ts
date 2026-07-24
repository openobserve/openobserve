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

import { ref, type Ref } from "vue";
import settings from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";

export interface HomeDashboard {
  dashboardId: string;
  folderId: string;
  label: string;
}

const SETTING_KEY = "home_dashboard";
const SETTING_CATEGORY = "ui";

// Module-level shared reactive state — one source for all consumers.
const homeDashboard: Ref<HomeDashboard | null> = ref(null);
const isLoading = ref(false);

export function useHomeDashboard() {
  const isHome = (dashboardId: string) => homeDashboard.value?.dashboardId === dashboardId;

  const load = async (org: string) => {
    if (!org) return;
    isLoading.value = true;
    try {
      const res = await settings.getSetting(org, SETTING_KEY);
      const val = res?.data?.setting_value;
      homeDashboard.value = val && val.dashboardId ? (val as HomeDashboard) : null;
    } catch {
      // Missing setting / 404 → no home dashboard for this org.
      homeDashboard.value = null;
    } finally {
      isLoading.value = false;
    }
  };

  const errMessage = (e: any, action: string) =>
    e?.response?.status === 403
      ? "You don't have permission to change the home dashboard"
      : `Couldn't ${action} the home dashboard`;

  const setHomeDashboard = async (org: string, d: HomeDashboard) => {
    if (!org) return; // no org → don't hit the API with an undefined segment
    const prev = homeDashboard.value;
    homeDashboard.value = d; // optimistic
    try {
      await settings.setOrgSetting(org, SETTING_KEY, d, SETTING_CATEGORY);
    } catch (e: any) {
      homeDashboard.value = prev; // revert
      toast({ variant: "error", message: errMessage(e, "set") });
    }
  };

  const clearHomeDashboard = async (org: string) => {
    if (!org) return; // no org → don't hit the API with an undefined segment
    const prev = homeDashboard.value;
    homeDashboard.value = null; // optimistic
    try {
      await settings.deleteOrgSetting(org, SETTING_KEY);
    } catch (e: any) {
      // A 404 means the setting is already gone — this is the desired end state,
      // not a failure. The backend now clears home_dashboard itself when the
      // pinned dashboard is deleted, so the client's delete can race and find it
      // already absent. Treat "already cleared" as success: keep the optimistic
      // null, don't revert, don't toast. Only real errors revert.
      if (e?.response?.status === 404) return;
      homeDashboard.value = prev; // revert
      toast({ variant: "error", message: errMessage(e, "remove") });
    }
  };

  // Auto-sync the label when the dashboard's live title differs from what we
  // stored (e.g. it was renamed since it was set as home). Update the ref AND
  // persist to the server — otherwise the next load() would restore the stale
  // label. Fire-and-forget: a failed persist just leaves the fresh label for
  // this session and re-attempts on the next rename; never toast for it.
  const updateLabel = (org: string, dashboardId: string, label: string) => {
    if (homeDashboard.value?.dashboardId === dashboardId && homeDashboard.value.label !== label) {
      const updated = { ...homeDashboard.value, label };
      homeDashboard.value = updated;
      if (org) {
        settings.setOrgSetting(org, SETTING_KEY, updated, SETTING_CATEGORY).catch(() => {
          /* label persist is best-effort; ref already shows the fresh label */
        });
      }
    }
  };

  return {
    homeDashboard,
    isLoading,
    isHome,
    load,
    setHomeDashboard,
    clearHomeDashboard,
    updateLabel,
  };
}
