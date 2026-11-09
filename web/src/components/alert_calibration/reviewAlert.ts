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

import type { Router } from "vue-router";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import { alertFolderOf, editAlertRoute } from "./alertEditorLink";
import { toEditHandoff, type ReviewAlertAction } from "./applySuggestion";

export interface ReviewedFinding {
  alert_name?: string | null;
  finding_id?: string;
  rule_id?: string;
}

/** Opens the alert editor at the action's focus in the same tab, so its Cancel comes back here. */
export async function openAlertReview(
  router: Router,
  org: string,
  action: ReviewAlertAction,
  finding: ReviewedFinding,
  isLive: () => boolean = () => true,
): Promise<void> {
  // Looked up on click, not per card: a page can hold many cards.
  const folder = await alertFolderOf(org, action.alert_id, finding.alert_name);
  if (!isLive()) return;
  writeAlertEditHandoff(toEditHandoff(action, finding));
  void router.push(editAlertRoute(org, action.alert_id, folder));
}
