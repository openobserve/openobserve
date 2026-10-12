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

import { reactive } from "vue";
import type {
  ConflictChange,
  DashboardSettingKey,
  PanelComparison,
} from "@/utils/dashboard/saveConflict";

export type ConflictStep = "loading" | "main" | "confirm" | "review" | "error";
export type ConflictAction = "reload" | "overwrite" | "merge" | "saveMerged";
export type ConflictNotice = "savedAgain" | "stillUnresolved" | "saveFailed" | null;
export type ConflictOutcome = "reloaded" | "overwritten" | "merged";

export interface MergedPanelRow {
  key: string;
  name: string;
  tag: "yours" | "theirsNew" | "theirsEdited" | null;
}

// Kept free of service imports so the app shell can mount the dialog lazily.
export const dashboardSaveConflictState = reactive({
  mounted: false,
  open: false,
  step: "loading" as ConflictStep,
  busy: null as ConflictAction | null,
  notice: null as ConflictNotice,
  errorMessage: "",
  dashboardId: "",
  isPanelEditor: false,
  panelTouched: false,
  hasBase: false,
  hasMine: false,
  latestUpdatedAt: null as number | null,
  changes: [] as ConflictChange[],
  changedSettings: [] as DashboardSettingKey[],
  panelComparison: null as PanelComparison | null,
  myChange: "",
  mergedRows: [] as MergedPanelRow[],
  mergeUnavailable: false,
  /** The dashboard whose last save lost a conflict and is still not saved. */
  unresolvedDashboardId: "",
  resolvedSeq: 0,
  resolvedDashboardId: "",
  resolvedOutcome: null as ConflictOutcome | null,
});
