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
const READ_TRIAGE: readonly PermissionType[] = ["AllowList", "AllowGet", "AllowPut"];
// Security POST is detection authoring, kept apart from the analyst's PUT triage.
const READ_AUTHOR: readonly PermissionType[] = ["AllowList", "AllowGet", "AllowPost"];

/** Role starting points named after a job, with the companion grants each needs; stream reads are org-wide (the stream wildcard, like Read-Only) and the preset detail says so before Add. */
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
  {
    id: "soc_analyst",
    titleKey: "iam.editRole.presetSocAnalystTitle",
    descriptionKey: "iam.editRole.presetSocAnalystDescription",
    icon: "manage-search",
    tone: "security",
    grants: {
      security: READ_TRIAGE,
      incidents: READ_TRIAGE,
      afolder: READ,
      stream: READ,
      // The Intel page lists threat-intel enrichment tables.
      enrichment_table: READ,
    },
  },
  {
    id: "detection_engineer",
    titleKey: "iam.editRole.presetDetectionEngineerTitle",
    descriptionKey: "iam.editRole.presetDetectionEngineerDescription",
    icon: "shield-alert-outline",
    tone: "security",
    grants: {
      security: READ_AUTHOR,
      // Cases list detections' incidents; engineers read them but do not triage.
      incidents: READ,
      afolder: ALL,
      // Attaching an OCSF pack writes its normalising function and pipeline.
      function: ALL,
      pipeline: ALL,
      stream: READ,
      // Threat-intel lists are enrichment tables, and detection engineers own them.
      enrichment_table: ALL,
    },
  },
  {
    id: "security_admin",
    titleKey: "iam.editRole.presetSecurityAdminTitle",
    descriptionKey: "iam.editRole.presetSecurityAdminDescription",
    icon: "admin-panel-settings",
    tone: "security",
    grants: {
      security: ALL,
      incidents: ALL,
      afolder: ALL,
      enrichment_table: ALL,
      cipher_keys: ALL,
      function: ALL,
      pipeline: ALL,
      // Detections, Events, Entities, UEBA and Content query the source streams.
      stream: READ,
    },
  },
  {
    id: "security_viewer",
    titleKey: "iam.editRole.presetSecurityViewerTitle",
    descriptionKey: "iam.editRole.presetSecurityViewerDescription",
    icon: "verified-user",
    tone: "security",
    grants: {
      security: READ,
      incidents: READ,
      afolder: READ,
      // Entities, UEBA and Events query the source streams.
      stream: READ,
    },
  },
];
