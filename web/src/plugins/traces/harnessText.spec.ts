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

import { describe, it, expect } from "vitest";
import { compileHarnessPattern, patternsForAgent, stripHarness } from "./harnessText";

describe("stripHarness (AIO-22)", () => {
  const patterns = ["tag system-reminder", "tag job"];

  it("hides wrapper blocks and keeps the request", () => {
    const out = stripHarness(
      "<system-reminder>\nctx\n</system-reminder>\nFix the durations.",
      patterns,
    );
    expect(out).toEqual({ text: "Fix the durations.", hidden: 1, only: null });
  });

  it("names the tag when the message was only harness text", () => {
    expect(stripHarness('<job id="7">nightly</job>', patterns)).toEqual({
      text: "",
      hidden: 1,
      only: "job",
    });
  });

  it("supports regex patterns and ignores invalid ones", () => {
    expect(stripHarness("Caveat: x\nreal ask", ["regex Caveat:[^\\n]*", "regex ("]).text).toBe(
      "real ask",
    );
    expect(compileHarnessPattern("tag <bad>")).toBeNull();
    expect(compileHarnessPattern("glob *")).toBeNull();
  });

  it("keeps one agent's patterns off another agent", () => {
    const rules = [{ agent: "omp", patterns }];
    expect(patternsForAgent(rules, "omp")).toEqual(patterns);
    expect(patternsForAgent(rules, "support-bot")).toEqual([]);
    expect(patternsForAgent(rules, null)).toEqual([]);
  });
});
