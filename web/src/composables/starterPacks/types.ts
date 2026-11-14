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

import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import type { I18nKey } from "@/types/i18n";

export type PackFolderType = "dashboards" | "alerts";

export type PackItemKind = "folder" | "dashboard" | "alert" | "savedView";

/** `existing` was there before this install, so undo never touches it. */
export type PackItemStatus = "pending" | "created" | "existing" | "failed" | "skipped";

export type PackInstallStatus = "installing" | "complete" | "incomplete" | "removed";

export type PackKeptReason = "changed" | "not_empty" | "delete_failed" | "unrecorded";

export interface PackDashboard {
  id: string;
  title: string;
  load: () => Promise<Record<string, any>>;
}

export interface PackSavedView {
  id: string;
  name: string;
  /** Logs search object; everything absent takes the page default on restore. */
  search: Record<string, any>;
}

/** A Library alert shipped in the build, so the pack installs with the Library out of reach. */
export interface PackBundledAlert {
  entry: AlertLibraryEntry;
  file: AlertLibraryFile;
}

/** A stream name the installer changed to fit this org's data. */
export interface PackRepair {
  from: string;
  to: string;
}

export interface StarterPack {
  id: string;
  version: string;
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  /** Created in both the dashboards and the alerts module. */
  folder: { name: string; description: string };
  dashboards: PackDashboard[];
  /** Alert Library entry ids. */
  alerts: string[];
  savedViews: PackSavedView[];
  bundledAlerts?: PackBundledAlert[];
}

export interface PackRecordItem {
  kind: PackItemKind;
  /** Stable name inside the pack, never the server id. */
  itemId: string;
  status: PackItemStatus;
  id?: string;
  /** Delete and read routes authorize against the folder. */
  folderId?: string;
  /** Content hash read back right after create. */
  sourceHash?: string;
}

export interface PackInstallRecord {
  packId: string;
  installId: string;
  status: PackInstallStatus;
  items: PackRecordItem[];
  /** Microseconds; starts the Undo window. */
  installedAt?: number;
  installedBy?: string;
  version?: string;
  repairs?: PackRepair[];
  /** Set when the chosen folder is not the pack's own; a resumed install must reuse it. */
  folderName?: string;
  /** Someone chose Keep off, so Home stops reminding. */
  keptOff?: boolean;
}

export interface PackKeptItem {
  kind: PackItemKind;
  itemId: string;
  reason: PackKeptReason;
}

export type PackNotIncludedReason = "already_have" | "no_data" | "unavailable" | "needs_plan";

export interface PackNotIncludedItem {
  kind: PackItemKind | "view";
  itemId: string;
  name: string;
  reason: PackNotIncludedReason;
}

/** The ids the preview leaves out, which the install must never attempt. */
export const leftOutIds = (preview: Pick<PackPreview, "notIncluded">): string[] =>
  preview.notIncluded.filter(({ reason }) => reason !== "already_have").map(({ itemId }) => itemId);

export interface PackPreview {
  items: PackRecordItem[];
  names: Record<string, string>;
  notIncluded: PackNotIncludedItem[];
  /** Panels of the pack dashboard that fit this org's data. */
  panels: { kept: number; dropped: number };
  /** The Library was out of reach, so this came from the build's own copy. */
  offline: boolean;
  repairs: PackRepair[];
}

export interface PackInstallOptions {
  /** Item ids the preview left out; a resumed install keeps its own list. */
  exclude?: string[];
  repairs?: PackRepair[];
  /** Admin's Set up in… choice; absent means the pack's own folder. */
  folderName?: string;
  onProgress?: (record: PackInstallRecord) => void;
}

export interface PackRemovalResult {
  removed: PackRecordItem[];
  kept: PackKeptItem[];
}

/** The KV write was refused, so nothing was created. */
export class StarterPackPermissionError extends Error {
  constructor() {
    super("starter_pack_forbidden");
    this.name = "StarterPackPermissionError";
  }
}
