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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";
import type { PermissionType } from "@/ts/interfaces";
import type { ModuleGroupId } from "@/components/iam/roles/roleModules";

export type JobPreset = {
  id: string;
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  icon: IconName;
  /** Rail group whose tile colour the preset borrows. */
  tone: ModuleGroupId;
  /** Module-wide grants, by resource key, on `_all_<org>`. */
  grants: Record<string, readonly PermissionType[]>;
};

const ALL: readonly PermissionType[] = ["AllowAll"];
const READ: readonly PermissionType[] = ["AllowList", "AllowGet"];

/** Role starting points named after a job; each one also carries the companion grants it needs, Streams Get included. */
export const JOB_PRESETS: JobPreset[] = [
  {
    id: "alert_manager",
    titleKey: "iam.editRole.presetAlertManagerTitle",
    descriptionKey: "iam.editRole.presetAlertManagerDescription",
    icon: "notifications-active",
    tone: "alerting",
    grants: { afolder: ALL, destination: ALL, template: ALL, stream: READ },
  },
  {
    id: "alert_viewer",
    titleKey: "iam.editRole.presetAlertViewerTitle",
    descriptionKey: "iam.editRole.presetAlertViewerDescription",
    icon: "notifications",
    tone: "alerting",
    grants: { afolder: READ, destination: READ, template: READ },
  },
  {
    id: "dashboard_editor",
    titleKey: "iam.editRole.presetDashboardEditorTitle",
    descriptionKey: "iam.editRole.presetDashboardEditorDescription",
    icon: "dashboard-customize",
    tone: "dashboards",
    grants: { dfolder: ALL, stream: READ },
  },
  {
    id: "dashboard_viewer",
    titleKey: "iam.editRole.presetDashboardViewerTitle",
    descriptionKey: "iam.editRole.presetDashboardViewerDescription",
    icon: "dashboard",
    tone: "dashboards",
    grants: { dfolder: READ, stream: READ },
  },
  {
    id: "pipeline_editor",
    titleKey: "iam.editRole.presetPipelineEditorTitle",
    descriptionKey: "iam.editRole.presetPipelineEditorDescription",
    icon: "lan",
    tone: "pipelines",
    grants: { pipeline: ALL, function: ALL, stream: READ, enrichment_table: READ },
  },
];
