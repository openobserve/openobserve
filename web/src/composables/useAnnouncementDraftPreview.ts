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

import { readonly, ref } from "vue";

import type { Banner } from "@/composables/useAnnouncementBanners";

// Module scope on purpose: the editor writes and the app-wide bar, mounted elsewhere, reads.
const draft = ref<Banner | null>(null);
/** The stored message of the banner being edited, so its live copy steps aside for the draft. */
const replaces = ref<string | null>(null);
const configVersion = ref(0);

/** Lets the banner editor show its unsaved draft in the real top bar, at true width and theme. */
export function useAnnouncementDraftPreview() {
  return {
    draft: readonly(draft),
    replaces: readonly(replaces),
    /** Bumped after a save, so the live bar refetches instead of waiting for its poll. */
    configVersion: readonly(configVersion),
    setDraft: (banner: Banner | null, replacesMessage: string | null = null) => {
      draft.value = banner;
      replaces.value = banner ? replacesMessage : null;
    },
    notifyConfigChanged: () => {
      configVersion.value += 1;
    },
  };
}
