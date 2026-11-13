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
import { coverageStateSentence } from "./LiveCoverageSentence";

const totals = (fullyWatched: number, partial: number, gaps: number, learning = 0) => ({
  total: fullyWatched + partial + gaps + learning,
  learning,
  fullyWatched,
  partial,
  gaps,
});
const say = (t: ReturnType<typeof totals>) => String(coverageStateSentence(gt, "en-US", t));

describe("coverageStateSentence", () => {
  it("keeps today's sentence when no service is partly watched", () => {
    expect(say(totals(3, 0, 1))).not.toContain("partly");
    expect(say(totals(3, 0, 1))).toContain("3 of your 4 services");
  });

  it("counts every listed service, as the header does, and names learning ones apart", () => {
    expect(say(totals(2, 20, 2, 6))).toBe(
      "I'm fully watching 2 of your 30 services. 20 are partly watched: some of their checks have no alert. 2 have a coverage gap. 6 are still learning.",
    );
    expect(say(totals(3, 0, 0, 1))).toBe(
      "I'm fully watching 3 of your 4 services. 1 is still learning.",
    );
  });

  it("drops the gap part at zero and reads one service in the singular", () => {
    expect(say(totals(0, 1, 0))).toBe(
      "I'm fully watching 0 of your 1 service. 1 is partly watched: some of its checks have no alert.",
    );
  });

  it("formats large counts for the locale", () => {
    expect(say(totals(1200, 3400, 0))).toContain("1,200 of your 4,600 services");
  });
});
