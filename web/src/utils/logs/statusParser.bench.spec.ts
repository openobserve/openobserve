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

import { describe, expect, it } from "vitest";
import {
  buildSeverityProjection,
  resolveLogSeverity,
  severityIndicatorColor,
  severityRowClass,
} from "./statusParser";

const ROWS = 1000;
const MESSAGE_BYTES = 2048;

const makeRows = () =>
  Array.from({ length: ROWS }, (_, i) => {
    const head = i % 3 === 0 ? "2026-10-06 12:00:01 ERROR payment failed " : "user logged in ";
    const filler = `k${i}=v${i} `.repeat(MESSAGE_BYTES);
    return {
      _timestamp: 1_791_288_002_995_000 + i,
      message: (head + filler).slice(0, MESSAGE_BYTES),
    };
  });

const projection = buildSeverityProjection({
  sqlMode: false,
  quickMode: false,
  interestingFields: [],
  sqlColumns: "all",
  streams: [{ name: "app", schema: [{ name: "_timestamp" }, { name: "message" }] }],
  selectedStreams: ["app"],
  streamNameField: "_stream_name",
  quickModeNumFields: 500,
  quickModeForceEnabled: true,
});

const renderPass = (rows: ReturnType<typeof makeRows>) => {
  const started = performance.now();
  for (const row of rows) {
    severityIndicatorColor(resolveLogSeverity(row, projection));
    severityRowClass(resolveLogSeverity(row, projection));
  }
  return performance.now() - started;
};

describe("S-A2 severity render cost (1,000 rows, 2 KB messages)", () => {
  it("resolves severity across cold and memoised render passes", () => {
    const rows = makeRows();
    expect(rows.every((r) => r.message.length === MESSAGE_BYTES)).toBe(true);
    renderPass(rows);
    renderPass(rows);
    expect(rows.filter((r) => resolveLogSeverity(r, projection).level === "unknown")).toHaveLength(
      ROWS - Math.ceil(ROWS / 3),
    );
  });
});
