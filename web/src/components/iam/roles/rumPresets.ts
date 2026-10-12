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

export type RumPreset = "rum_viewer" | "rum_editor";

// The browser SDK ingests into these two log streams; every RUM tab reads them.
export const RUM_STREAMS = ["_rumdata", "_sessionreplay"];
export const RUM_STREAM_ROW_PERMS = ["AllowGet"] as const;

// GET /{org}/streams checks `logs:_all_<org>`, and ALLOW_GET there would read every log stream.
export const RUM_TYPE_NODE_PERMS = ["AllowList"] as const;

export const RUM_SOURCEMAPS_RESOURCE = "sourcemaps";
export const RUM_SOURCEMAPS_PERMS = ["AllowList"] as const;

// Reads of /rum/analytics/* are checked against logs:_rumdata, so only writes are enforced here.
export const RUM_ANALYTICS_RESOURCE = "rum_analytics";
export const RUM_ANALYTICS_WRITE_PERMS = ["AllowPost", "AllowPut", "AllowDelete"] as const;

export const RUM_PRESETS: Record<RumPreset, { withWrite: boolean }> = {
  rum_viewer: { withWrite: false },
  rum_editor: { withWrite: true },
};
