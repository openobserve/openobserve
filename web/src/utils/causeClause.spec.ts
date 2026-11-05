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
import { toCauseClause } from "./causeClause";

describe("toCauseClause", () => {
  it("lowercases a sentence's opening word and drops its closing stop", () => {
    expect(toCauseClause("Alert is being edited.")).toBe("alert is being edited");
    expect(toCauseClause("  Folder not found!  ")).toBe("folder not found");
  });

  it("keeps an opening acronym or mixed-case name as sent", () => {
    expect(toCauseClause("SSRF guard blocked the URL")).toBe("SSRF guard blocked the URL");
    expect(toCauseClause("HTTP: 502 from upstream.")).toBe("HTTP: 502 from upstream");
    expect(toCauseClause("OpenObserve is starting")).toBe("OpenObserve is starting");
  });

  it("leaves a clause that already starts lowercase or with a digit alone", () => {
    expect(toCauseClause("quota exceeded")).toBe("quota exceeded");
    expect(toCauseClause("3 alerts are locked")).toBe("3 alerts are locked");
  });
});
