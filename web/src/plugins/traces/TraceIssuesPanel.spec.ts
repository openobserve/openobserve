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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import TraceIssuesPanel from "./TraceIssuesPanel.vue";
import type { TraceIssue } from "./traceIssues";

const issue: TraceIssue = {
  rule: "repeated_tool_calls",
  tool: "web_search",
  calls: 12,
  errors: 9,
  threshold: 10,
  evidence: Array.from({ length: 12 }, (_, i) => `s${i + 1}`),
  lastSpanId: "s12",
};

describe("TraceIssuesPanel", () => {
  it("says why the rule fired from counts, and links the evidence", async () => {
    const w = mount(TraceIssuesPanel, { props: { issues: [issue] }, global: { plugins: [i18n] } });
    expect(w.text()).toContain("web_search ran 12 times in this trace. The rule fires at 10.");
    expect(w.text()).toContain("9 of the calls ended in an error");
    // First three calls, a gap, the last.
    expect(w.findAll("[data-test^='trace-issue-evidence-']").map((b) => b.text())).toEqual([
      "call 1",
      "call 2",
      "call 3",
      "call 12",
    ]);
    await w.find("[data-test='trace-issue-evidence-s12']").trigger("click");
    expect(w.emitted("select-span")?.[0]).toEqual(["s12"]);
  });
});
