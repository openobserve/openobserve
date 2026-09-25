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
  | "user"
  | "serviceAccount"
  | "org"
  | "synthetic"
  | "ai";

/** A scope is a left-rail category key (e.g. "logs", "reliability", "data"); chips mirror the rail. */
export type PaletteScope = string;

/** Rail category that pins a create verb first when selected with an empty query. */
export const SCOPE_CREATE_ACTIONS: Record<string, string[]> = {
  dashboards: ["action:newDashboard", "action:importDashboard"],
  reliability: ["action:newAlert"],
  alertList: ["action:newAlert"],
  data: ["action:newPipeline", "action:newFunction"],
  pipeline: ["action:newPipeline", "action:newFunction"],
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
  /** Left-rail category the row belongs to; rows without one show only when no scope is selected. */
  group?: string;
  /** org_identifier is injected at navigation time, never stored here. */
  route?: RouteLocationRaw;
  href?: string;
  run?: () => void | Promise<void>;
}

export type PaletteRow =
  { kind: "header"; key: string; label: string } | { kind: "item"; key: string; item: PaletteItem };

export type FrecencyBucketName = "palette_item" | "palette_scope";

/** Display data kept with an entity's frecency record so Recent can show it without a lookup. */
export interface PaletteSnapshot {
  type: PaletteItemType;
  label: string;
  subtitle?: string;
  icon: string;
  group?: string;
  route?: RouteLocationRaw;
}

export interface FrecencyRecord {
  item_id: string;
  count: number;
  /** Epoch ms of the most recent selection. */
  last: number;
  item?: PaletteSnapshot;
}

/** One user's per-org frecency buckets, as stored in the user setting. */
export interface FrecencyDoc {
  v: 1;
  buckets: Record<string, Partial<Record<FrecencyBucketName, FrecencyRecord[]>>>;
}
