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
import { useStore } from "vuex";

import { notifyAnnouncementsChanged } from "@/composables/useAnnouncementBanners";
import {
  announcementConfigQuery,
  saveAnnouncementConfigMutation,
  type AnnouncementConfig,
} from "@/services/announcements.queries";

/** Thrown by a change when the part of the config it edits moved since the page loaded it. */
export class AnnouncementConflictError extends Error {}

/** Same-document comparison: both sides come straight from the stored JSON. */
export const sameAuthored = (a: unknown, b: unknown) =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** Read-modify-write of the whole stored config, re-read first so a concurrent save is not lost. */
export function useAnnouncementConfigUpdate() {
  const store = useStore();
  const queryClient = useQueryClient();
  const metaOrg = computed<string>(() => store.state.zoConfig?.meta_org ?? "");
  const saveConfig = useMutation(() => saveAnnouncementConfigMutation(metaOrg.value));

  const update = async (change: (latest: AnnouncementConfig) => AnnouncementConfig) => {
    const latest = await queryClient.fetchQuery({
      ...announcementConfigQuery(metaOrg.value),
      staleTime: 0,
    });
    await saveConfig.mutateAsync(change(latest));
    notifyAnnouncementsChanged();
  };

  return { update, isPending: saveConfig.isPending };
}
