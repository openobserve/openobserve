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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

const { mockCopy } = vi.hoisted(() => ({ mockCopy: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: mockCopy }));

import O2AIChatToolCallBlock from "./O2AIChatToolCallBlock.vue";

const detailed = (extra: Record<string, unknown> = {}) => ({
  type: "tool_call",
  tool: "SearchSQL",
  message: "Searching",
  success: true,
  summary: { count: 12 },
  context: { sql: "SELECT 1" },
  ...extra,
});

function mountBlock(block: any, expandedKeys = new Set<string>(), messageIndex = 3, blockIndex = 5) {
  return mount(O2AIChatToolCallBlock, {
    global: { plugins: [i18n] },
    props: { block, messageIndex, blockIndex, expandedKeys },
  });
}

describe("O2AIChatToolCallBlock", () => {
  beforeEach(() => mockCopy.mockClear());

  it("expands only for its own positional key", () => {
    expect(mountBlock(detailed(), new Set(["3-5"])).find(".tool-call-details").exists()).toBe(true);
    expect(mountBlock(detailed(), new Set(["5-3"])).find(".tool-call-details").exists()).toBe(false);
    expect(mountBlock(detailed(), new Set(["3-50"])).find(".tool-call-details").exists()).toBe(false);
  });

  it("emits toggle on click only when it has details and is not pending", async () => {
    const withDetails = mountBlock(detailed());
    await withDetails.trigger("click");
    expect(withDetails.emitted("toggle")).toHaveLength(1);
    expect(withDetails.classes()).toContain("has-details");

    const pending = mountBlock(detailed({ pendingConfirmation: true }));
    await pending.trigger("click");
    expect(pending.emitted("toggle")).toBeUndefined();
    expect(pending.classes()).toContain("pending-confirmation");

    const bare = mountBlock({ type: "tool_call", tool: "X", message: "m" });
    await bare.trigger("click");
    expect(bare.emitted("toggle")).toBeUndefined();
  });

  it("does not toggle when clicking inside the expanded details", async () => {
    const w = mountBlock(detailed(), new Set(["3-5"]));
    await w.find(".tool-call-details").trigger("click");
    expect(w.emitted("toggle")).toBeUndefined();
  });

  it("emits navigate with the action and does not also toggle", async () => {
    const action = { label: "Open", page: "logs", params: {} };
    const w = mountBlock(detailed({ navigationAction: action }));
    await w.find(".navigation-icon").trigger("click");
    expect(w.emitted("navigate")).toEqual([[action]]);
    expect(w.emitted("toggle")).toBeUndefined();
  });

  it("marks failures as error and shows the error details", () => {
    const w = mountBlock(
      detailed({ success: false, resultMessage: "it failed", errorType: "Timeout" }),
      new Set(["3-5"]),
    );
    expect(w.classes()).toContain("error");
    expect(w.find(".tool-call-details").text()).toContain("it failed");
    expect(w.find(".tool-call-details").text()).toContain("Timeout");
  });

  it("formats microsecond timestamps and copies the query", async () => {
    const w = mountBlock(
      detailed({ context: { request_body: { query: { sql: "SELECT 2", start_time: 1700000000000000 } } } }),
      new Set(["3-5"]),
    );
    expect(w.text()).toContain(new Date(1700000000000).toLocaleString());
    await w.find(".copy-btn").trigger("click");
    expect(mockCopy).toHaveBeenCalledWith("SELECT 2", expect.any(Function));
    expect(w.emitted("toggle")).toBeUndefined();
  });
});
