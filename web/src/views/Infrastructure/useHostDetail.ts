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

// Logs-preview helpers for the host detail drawer. The metrics grid moved to
// the hosts content pack and the curated engine (curated-pages design §8.2).

import { sqlEscape } from "./curated/resolve";

// Not derivable from this repo (§7 risk 1) — a wrong value degrades to an empty logs search, never an error.
export const HOST_LOGS_STREAM = "default";

export const LOGS_PREVIEW_LIMIT = 100;

// Re-exported from their new home so existing importers keep working (§8.2).
export { promEscape, sqlEscape } from "./curated/resolve";

export function buildLogsPreviewSql(host: string): string {
  return `SELECT * FROM "${HOST_LOGS_STREAM}" WHERE host_name = '${sqlEscape(host)}' ORDER BY _timestamp DESC LIMIT ${LOGS_PREVIEW_LIMIT}`;
}
