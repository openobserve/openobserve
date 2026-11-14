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

import type { PackRepair } from "./types";

const EXPORTER_PREFIXES = /^(?:otel_|otelcol_|prometheus_)/;

const strictKey = (name: string) =>
  name
    .toLowerCase()
    .replace(EXPORTER_PREFIXES, "")
    .replace(/_total$/, "");

/** Names that differ only by case, `_total` or an exporter prefix (D10); two candidates means ask, so none. */
export const strictRenames = (
  wanted: string[],
  available: Set<string>,
  used: Set<string> = new Set(),
): PackRepair[] =>
  wanted.flatMap((from) => {
    if (available.has(from)) return [];
    const matches = [...available].filter(
      (name) => strictKey(name) === strictKey(from) && !used.has(name),
    );
    return matches.length === 1 ? [{ from, to: matches[0] }] : [];
  });
