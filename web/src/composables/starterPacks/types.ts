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

/** A shared stream is narrowed to the records the user picked. */
export interface PackStreamFilter {
  field: string;
  value: string;
}

/** A stream name the installer changed to fit this org's data. */
export interface PackRepair {
  from: string;
  to: string;
  filter?: PackStreamFilter;
  /** Further streams from Use all: one alert copy each, and a dashboard stream picker. */
  also?: string[];
}

export type PackBindingTier = "exact" | "semantic" | "alias" | "chosen";

/** A field this item reads under another name in one stream. */
export interface PackBinding {
  stream: string;
  from: string;
  to: string;
  tier: PackBindingTier;
  /** Semantic group id or the alias list's first spelling. */
  group?: string;
}

/** A value that shows a stream carries this source; only stable identity fields qualify. */
export interface PackIdentityRule {
  field: string;
  pattern: string;
}

/** A log stream the pack needs by meaning, since its name is the user's choice. */
export interface PackStreamRole {
  id: string;
  titleKey: I18nKey;
  stream: string;
  /** Fields that make up the role's signature. */
  fields: string[];
  identity: PackIdentityRule[];
}

export interface PackFlavourAlert {
  promql: string;
  streams: string[];
}

/** The same source under another metric family, chosen when the shipped names are absent. */
export interface PackFlavour {
  id: string;
  titleKey: I18nKey;
  /** Any of these present means the org sends this flavour. */
  detect: string[];
  alerts: Record<string, PackFlavourAlert>;
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
  /** Spellings of one field; the only alias source on OSS, which has no semantic groups. */
  aliases?: string[][];
  /** Wording for an alias list, keyed by its first spelling. */
  aliasTitles?: Record<string, I18nKey>;
  roles?: PackStreamRole[];
  flavours?: PackFlavour[];
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
  /** Library alert this Use all copy came from. */
  copyOf?: string;
  stream?: string;
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
  bindings?: PackBinding[];
  /** Alert id to flavour id, so a resumed install writes the same query. */
  flavours?: Record<string, string>;
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

export type PackNotIncludedReason =
  "already_have" | "no_data" | "unavailable" | "needs_plan" | "no_flavour";

export interface PackNotIncludedItem {
  kind: PackItemKind | "view";
  itemId: string;
  name: string;
  reason: PackNotIncludedReason;
}

/** The ids the preview leaves out, which the install must never attempt. */
export const leftOutIds = (preview: Pick<PackPreview, "notIncluded">): string[] =>
  preview.notIncluded.filter(({ reason }) => reason !== "already_have").map(({ itemId }) => itemId);

export interface PackCandidate {
  stream: string;
  matched: number;
  total: number;
  /** Top identity values, shown as evidence. */
  samples: string[];
}

export type PackQuestionKind = "confirm" | "shared" | "none";

/** One expected stream the data does not name; answered ones stay listed so they can change. */
export interface PackQuestion {
  want: string;
  streamType: string;
  kind: PackQuestionKind;
  titleKey?: I18nKey;
  candidates: PackCandidate[];
  /** Filter field and its top values for each shared candidate, keyed by stream. */
  filters?: Record<string, { field: string; values: string[] }>;
  answer?: PackRepair;
}

/** What the user decided in the drawer, read again by every later preview. */
export interface PackChoices {
  streams: Record<string, Omit<PackRepair, "from"> | undefined>;
  /** Keyed `stream/field`. */
  fields: Record<string, string>;
}

export interface PackPreview {
  items: PackRecordItem[];
  names: Record<string, string>;
  notIncluded: PackNotIncludedItem[];
  /** Panels of the pack dashboard that fit this org's data. */
  panels: { kept: number; dropped: number };
  /** The Library was out of reach, so this came from the build's own copy. */
  offline: boolean;
  repairs: PackRepair[];
  bindings: PackBinding[];
  questions: PackQuestion[];
  /** Column names by stream, for changing a field binding. */
  columns: Record<string, string[]>;
  /** Semantic group wording by group id. */
  groupTitles: Record<string, string>;
  flavours: Record<string, string>;
  copies: Array<{ copyOf: string; stream: string }>;
}

export interface PackInstallOptions {
  /** Item ids the preview left out; a resumed install keeps its own list. */
  exclude?: string[];
  repairs?: PackRepair[];
  bindings?: PackBinding[];
  flavours?: Record<string, string>;
  copies?: PackPreview["copies"];
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
