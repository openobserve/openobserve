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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import i18n from "@/locales";

const here = dirname(fileURLToPath(import.meta.url));

describe("the blocked-queries footer reads as a sentence for one wait and for many", () => {
  const t = i18n.global.t as (key: string, params: Record<string, unknown>, n: number) => string;

  it("one wait leads back, without an 'All'", () => {
    const line = t(
      "dbm.blocked.footer.allLeadBack",
      { waits: "1 session waiting on a lock right now", pid: 12127 },
      1,
    );
    expect(line).toBe("1 session waiting on a lock right now leads back to pid 12127");
  });

  it("several waits all lead back", () => {
    const line = t(
      "dbm.blocked.footer.allLeadBack",
      { waits: "3 sessions waiting on a lock right now", pid: 12127 },
      3,
    );
    expect(line).toBe("All 3 sessions waiting on a lock right now lead back to pid 12127");
  });

  it("the page passes the wait count that picks the form", () => {
    const source = readFileSync(join(here, "BlockedQueriesPage.vue"), "utf8");
    const call = source.split('"dbm.blocked.footer.allLeadBack"')[1]?.split(");")[0] ?? "";
    expect(call.trim().endsWith("waitingCount.value,")).toBe(true);
  });
});
