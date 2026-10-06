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
import { useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query";
import { permittedFoldersQuery } from "@/services/common.queries";
import {
  preferredDowntimeFolder,
  readLastDowntimeFolder,
  rememberDowntimeFolder,
} from "@/utils/downtimes/folderDefault";

/** The folder a new downtime is filed in, resolved from the folders this user may use. */
export function useDefaultDowntimeFolder(options: { rememberLast?: boolean } = {}) {
  const { rememberLast = true } = options;
  const orgId = useOrgId();
  const folders = useQuery(() =>
    Object.assign(permittedFoldersQuery(orgId.value, "downtimes"), { enabled: !!orgId.value }),
  );

  /** False until the folder list answered, so nothing is sent against a guessed folder. */
  const ready = computed(() => folders.data.value !== undefined || folders.isError.value);

  const folderId = computed(() =>
    preferredDowntimeFolder(
      folders.data.value?.map((f) => f.folderId),
      rememberLast ? readLastDowntimeFolder(orgId.value) : null,
    ),
  );

  const remember = (id: string) => rememberDowntimeFolder(orgId.value, id);

  return { folderId, ready, remember };
}
