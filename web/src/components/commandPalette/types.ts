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

import type { RouteLocationRaw } from "vue-router";

/** Kind of thing a palette row points at; also the prefix of every row id. */
export type PaletteItemType =
  | "page"
  | "action"
  | "external"
  | "dashboard"
  | "alert"
  | "stream"
  | "savedView"
  | "function"
  | "pipeline"
  | "ai";

/** A chip the user can narrow the list to; each maps to one or more item types. */
export type PaletteScope =
  "actions" | "pages" | "dashboard" | "alert" | "stream" | "savedView" | "function" | "pipeline";

// Fixed order mirroring the left rail; a filter bar must look the same on every open.
export const SCOPE_ORDER: PaletteScope[] = [
  "pages",
  "dashboard",
  "alert",
  "stream",
  "pipeline",
  "function",
  "savedView",
  "actions",
];

export function scopeOfType(type: PaletteItemType): PaletteScope | null {
  switch (type) {
    case "action":
    case "external":
      return "actions";
    case "page":
      return "pages";
    case "ai":
      return null;
    default:
      return type;
  }
}

/** The create verb pinned first when a scope is selected with an empty query. */
export const SCOPE_CREATE_ACTION: Partial<Record<PaletteScope, string>> = {
  dashboard: "action:newDashboard",
  alert: "action:newAlert",
  function: "action:newFunction",
  pipeline: "action:newPipeline",
};

export interface PaletteTrailing {
  kind: "path" | "url" | "shortcut";
  value: string;
}

export interface PaletteItem {
  /** Stable id, `<type>:<key>`; also the frecency key. */
  id: string;
  type: PaletteItemType;
  label: string;
  subtitle?: string;
  icon: string;
  trailing?: PaletteTrailing;
  /** Extra match terms (route name, group, aliases). */
  keywords?: string[];
  /** org_identifier is injected at navigation time, never stored here. */
  route?: RouteLocationRaw;
  href?: string;
  run?: () => void | Promise<void>;
}

export type PaletteRow =
  { kind: "header"; key: string; label: string } | { kind: "item"; key: string; item: PaletteItem };

export type FrecencyBucketName = "palette_item" | "palette_scope";

export interface FrecencyRecord {
  item_id: string;
  count: number;
  /** Epoch ms of the most recent selection. */
  last: number;
}

/** One user's per-org frecency buckets, as stored in the user setting. */
export interface FrecencyDoc {
  v: 1;
  buckets: Record<string, Partial<Record<FrecencyBucketName, FrecencyRecord[]>>>;
}
