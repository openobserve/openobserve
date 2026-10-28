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
import { useStore } from "vuex";
import {
  deleteEditorDraftsFor,
  listEditorDrafts,
  type EditorDraftKeyParts,
} from "@/utils/drafts/editorDraftStore";

const KIND = "oncall_schedule" as const;
const CLONE_PREFIX = "clone:";

/** One draft per rotation, under its team, so opening one rotation never offers another's work. */
export const rotationDraftId = (teamId: string, rotationId: string): string =>
  `${teamId}/${rotationId}`;

/** A new rotation's slot under its team; a duplicate gets its own slot per source rotation. */
export const newRotationVariant = (teamId: string, sourceId?: string | null): string =>
  sourceId ? `${teamId}/${CLONE_PREFIX}${sourceId}` : `${teamId}/new`;

// The rotation an entry is about: the edited rotation, a duplicate's source, or null for a plain new one.
const rotationOf = (entry: EditorDraftKeyParts, prefix: string): string | null => {
  if (entry.entityId !== null) return entry.entityId.slice(prefix.length);
  const rest = (entry.variant ?? "").slice(prefix.length);
  return rest.startsWith(CLONE_PREFIX) ? rest.slice(CLONE_PREFIX.length) : null;
};

const teamEntries = (org: string, userEmail: string, teamId: string) => {
  const prefix = `${teamId}/`;
  return listEditorDrafts(KIND, org, userEmail)
    .filter((entry) => (entry.entityId ?? entry.variant ?? "").startsWith(prefix))
    .map((entry) => ({ entry, rotationId: rotationOf(entry, prefix) }));
};

/** Reactive: when the newest of a team's rotation drafts was written, for the team's dots. */
export const useScheduleDraftTimes = () => {
  const store = useStore();
  const scope = computed(() => ({
    org: String(store.state.selectedOrganization?.identifier ?? ""),
    userEmail: String(store.state.userInfo?.email ?? ""),
  }));
  return (teamId: string): number | null => {
    const times = teamEntries(scope.value.org, scope.value.userEmail, teamId).map(
      ({ entry }) => entry.savedAt,
    );
    return times.length ? Math.max(...times) : null;
  };
};

/** Drops every user's drafts of a team's rotations, or with `liveRotationIds` only those whose rotation is gone. */
export const dropScheduleDrafts = (target: {
  org: string;
  teamId: string;
  liveRotationIds?: Set<string>;
}): void => {
  const { org, teamId, liveRotationIds } = target;
  const prefix = `${teamId}/`;
  deleteEditorDraftsFor({
    kind: KIND,
    org,
    match: (draft) => {
      if (!(draft.entityId ?? draft.variant ?? "").startsWith(prefix)) return false;
      if (!liveRotationIds) return true;
      const rotationId = rotationOf(draft, prefix);
      return rotationId !== null && !liveRotationIds.has(rotationId);
    },
  });
};
