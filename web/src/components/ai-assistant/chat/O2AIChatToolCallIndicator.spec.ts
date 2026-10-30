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
import O2AIChatToolCallIndicator from "./O2AIChatToolCallIndicator.vue";

function mountIndicator(context: Record<string, any>) {
  return mount(O2AIChatToolCallIndicator, {
    global: { plugins: [i18n] },
    props: { message: "Searching logs" as any, context },
  });
}

describe("O2AIChatToolCallIndicator", () => {
  it("renders the message and the query, and prefers the query over vrl", () => {
    const w = mountIndicator({ sql: "SELECT 1", vrl: ".a = 1" });
    expect(w.find(".tool-call-message").text()).toBe("Searching logs");
    const codes = w.findAll(".context-query");
    expect(codes).toHaveLength(1);
    expect(codes[0].text()).toBe("SELECT 1");
  });

  it("shows vrl only when there is no query", () => {
    const w = mountIndicator({ vrl: ".a = 1" });
    expect(w.findAll(".context-query").map((c) => c.text())).toEqual([".a = 1"]);
  });

  it("renders stream and query_type tags", () => {
    const w = mountIndicator({
      stream_name: "default",
      request_body: { query: { query_type: "sql" } },
    });
    const tags = w.findAll(".context-tag").map((c) => c.text());
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain("default");
    expect(tags[1]).toContain("sql");
  });

  it("omits the context row when the context has nothing to display", () => {
    const w = mountIndicator({});
    expect(w.find(".tool-call-context").exists()).toBe(false);
    expect(w.classes()).toContain("tool-call-indicator");
  });
});
