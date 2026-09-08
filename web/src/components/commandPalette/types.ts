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
