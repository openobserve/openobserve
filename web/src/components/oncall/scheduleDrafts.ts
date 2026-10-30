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

// Every rotation draft's key starts with its team id, which holds no slash.
const teamOf = (entry: EditorDraftKeyParts): string | null => {
  const key = entry.entityId ?? entry.variant ?? "";
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : null;
};

/** Reactive: when the newest of a team's rotation drafts was written, for the team's dots; storage is read once per draft revision. */
export const useScheduleDraftTimes = () => {
  const store = useStore();
  const newestByTeam = computed(() => {
    const newest = new Map<string, number>();
    const entries = listEditorDrafts(
      KIND,
      String(store.state.selectedOrganization?.identifier ?? ""),
      String(store.state.userInfo?.email ?? ""),
    );
    for (const entry of entries) {
      const teamId = teamOf(entry);
      if (teamId !== null) newest.set(teamId, Math.max(newest.get(teamId) ?? 0, entry.savedAt));
    }
    return newest;
  });
  return (teamId: string): number | null => newestByTeam.value.get(teamId) ?? null;
};

/** Drops every user's edit of a deleted rotation and every duplicate of it. */
export const dropRotationDrafts = (target: { org: string; teamId: string; rotationId: string }) =>
  deleteEditorDraftsFor({
    kind: KIND,
    org: target.org,
    entityId: rotationDraftId(target.teamId, target.rotationId),
    variant: newRotationVariant(target.teamId, target.rotationId),
  });

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
