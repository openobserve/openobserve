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

import type { I18nKey } from "@/types/i18n";

// Fleet Manager calls its folders fleets; every other folder type keeps the shared wording.
const FLEET_KEYS: Partial<Record<I18nKey, I18nKey>> = {
  "dashboard.folders": "fleet.tabs.fleets",
  "common.addFolder": "fleet.fleets.newFleet",
  "dashboard.searchFolder": "fleet.fleets.search",
  "dashboard.deleteFolder": "fleet.fleets.delete",
  "dashboard.deleteFolderMessage": "fleet.fleets.deleteMessage",
  "toastMessages.sidebar.folderDeletedSuccessfully": "fleet.fleets.deleted",
  "toastMessages.sidebar.folderDeletionFailed": "fleet.fleets.deleteFailed",
  "dashboard.updateFolder": "fleet.fleets.update",
  "toastMessages.sidebar.folderUpdatedSuccessfully": "fleet.fleets.updated",
  "toastMessages.sidebar.folderAddedSuccessfully": "fleet.fleets.added",
  "common.sidebar.folderUpdateFailed": "fleet.fleets.updateFailed",
  "common.sidebar.folderCreateFailed": "fleet.fleets.createFailed",
  "dashboard.selectFolderLabel": "fleet.fleets.select",
  "dashboard.selectFolderPlaceholder": "fleet.fleets.selectPlaceholder",
  "dashboard.moveToAnotherFolder": "fleet.fleets.moveTitle",
  "dashboard.currentFolderLabel": "fleet.fleets.current",
  "toastMessages.sidebar.movedSuccessfully": "fleet.fleets.moved",
  "toastMessages.sidebar.moveFailed": "fleet.fleets.moveFailed",
};

export function folderKey(type: string, key: I18nKey): I18nKey {
  return type === "fleets" ? (FLEET_KEYS[key] ?? key) : key;
}
