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
import { gt } from "@/types/i18n";
import { describeSeriesLimit } from "./panelNotices";

describe("describeSeriesLimit", () => {
  it("states one chart-wide cap for a single query", () => {
    const { body } = describeSeriesLimit({ shown: 100, total: 150, cap: 100 }, undefined, gt);
    expect(String(body)).toBe("Showing 100 of 150 series. A chart draws at most 100 series.");
  });

  it("states the cap per query when several queries each drew up to it", () => {
    const { body } = describeSeriesLimit(
      { shown: 115, total: 165, cap: 100, perQuery: true },
      undefined,
      gt,
    );
    expect(String(body)).toBe("Showing 115 of 165 series. Each query draws at most 100 series.");
  });
});
