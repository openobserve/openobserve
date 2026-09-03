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

// Per-workload configuration for the thin v1 stub pages (design 4.9).

import type { I18nKey } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

export type StubWorkloadId = "kubernetes" | "aws";

export interface WorkloadDef {
  titleKey: I18nKey;
  icon: IconName;
  chipKey: I18nKey;
  /** Case-insensitive title keyword selecting this workload's dashboards. */
  dashboardKeyword: string;
  /** Pre-seeds the template drawer's gallery search. */
  gallerySearch: string;
  /** Folders whose dashboards are listed on the detected face. */
  folders: string[];
  /** Undetected face: an inline setup card, or a route to instructions. */
  setup: { kind: "card"; slug: string } | { kind: "route"; routeName: string };
}

export const WORKLOAD_DEFS: Record<StubWorkloadId, WorkloadDef> = {
  kubernetes: {
    titleKey: "infra.workload.kubernetesTitle",
    icon: "hub",
    chipKey: "infra.workload.detectedChipKubernetes",
    dashboardKeyword: "kubernetes",
    gallerySearch: "kubernetes",
    folders: ["default"],
    setup: { kind: "card", slug: "kubernetes" },
  },
  aws: {
    titleKey: "infra.workload.awsTitle",
    icon: "cloud",
    chipKey: "infra.workload.detectedChipAws",
    dashboardKeyword: "aws",
    gallerySearch: "aws",
    // "AWS" is the one folder the AWS tile's ensureIntegrationsFolderExists creates.
    folders: ["default", "AWS"],
    setup: { kind: "route", routeName: "AWSConfig" },
  },
};
