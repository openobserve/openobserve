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

/**
 * Component-level tests for `ThreadView.vue`.
 *
 * Pure utility helpers (classify, buildTraceGroup, etc.) are tested
 * exhaustively in `threadView.utils.spec.ts`. This file focuses on the
 * SFC's rendering logic, computed values, UI interactions, and emit
 * contracts so the two suites stay complementary without duplication.
 */

// ---------------------------------------------------------------------------
// vi.mock() — hoisted before all imports.
// ---------------------------------------------------------------------------

vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => ({
      state: { theme: "light" },
    }),
  };
});

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";

import ThreadView from "./ThreadView.vue";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE_TIME_NS = 1_700_000_000_000_000_000; // nanoseconds

/** Minimal LLM-turn span that classify() maps to "llm_turn". */
function makeLLMSpan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trace_id: "trace-001",
    span_id: "span-llm-001",
    span_kind: "2",
    gen_ai_operation_name: "chat",
    gen_ai_input_messages: JSON.stringify([
      { role: "user", content: "Hello, world!" },
    ]),
    gen_ai_output_messages: JSON.stringify([
      { role: "assistant", content: "Hi there!" },
    ]),
    gen_ai_response_model: "gpt-4",
    gen_ai_usage_cost: "0.002",
    gen_ai_usage_total_tokens: "150",
    start_time: BASE_TIME_NS,
    end_time: BASE_TIME_NS + 500_000_000, // 500 ms later
    duration: 500_000_000,
    span_status: "UNSET",
    ...overrides,
  };
}

/** Tool-call span. */
function makeToolSpan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trace_id: "trace-001",
    span_id: "span-tool-001",
    gen_ai_operation_name: "execute_tool",
    tool_name: "search_db",
    gen_ai_input_messages: undefined,
    start_time: BASE_TIME_NS + 100_000_000,
    end_time: BASE_TIME_NS + 300_000_000,
    duration: 200_000_000,
    span_status: "UNSET",
    ...overrides,
  };
}

/** Root server span (span_kind "2", no parent). */
function makeRootSpan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trace_id: "trace-001",
    span_id: "span-root-001",
    span_kind: "2",
    start_time: BASE_TIME_NS - 10_000_000,
    end_time: BASE_TIME_NS + 600_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------

function mountThreadView(props: { spans: any[]; selectedSpanId?: string } = { spans: [] }) {
  return mount(ThreadView, {
    props,
    global: {
      stubs: {
        OBadge: {
          template: `<div class="o-badge" v-bind="$attrs"><slot /><slot name="icon" /></div>`,
        },
        OIcon: {
          template: `<span class="o-icon" v-bind="$attrs">{{ name }}</span>`,
          props: ["name", "size"],
        },
        OTooltip: { template: "<div />" },
      },
    },
  });
}

// ---------------------------------------------------------------------------

describe("ThreadView", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Empty / skeleton states
  // =========================================================================

  describe("empty state", () => {
    it("should render without errors when spans is an empty array", () => {
      wrapper = mountThreadView({ spans: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("should show the 'no spans' message when spans prop is empty", () => {
      wrapper = mountThreadView({ spans: [] });
      expect(wrapper.text()).toContain("No spans loaded for this trace.");
    });

    it("should not render the 'No LLM turns' message when spans is empty", () => {
      wrapper = mountThreadView({ spans: [] });
      expect(wrapper.text()).not.toContain("No LLM turns detected");
    });

    it("should show the 'no LLM turns' message when spans contain no chat spans", () => {
      // A root span only — classify() → "root", not "llm_turn"
      wrapper = mountThreadView({ spans: [makeRootSpan()] });
      expect(wrapper.text()).toContain("No LLM turns detected");
      expect(wrapper.text()).toContain("gen_ai.operation.name = chat");
    });

    it("should still render the summary toolbar even when spans is empty", () => {
      wrapper = mountThreadView({ spans: [] });
      const summary = wrapper.find(".thread-summary");
      expect(summary.exists()).toBe(true);
    });
  });

  // =========================================================================
  // Summary toolbar chip values
  // =========================================================================

  describe("summary toolbar", () => {
    it("should display Steps count equal to the number of LLM-turn spans", () => {
      const llm = makeLLMSpan();
      wrapper = mountThreadView({ spans: [llm] });
      const text = wrapper.find(".thread-summary").text();
      expect(text).toContain("Steps");
      expect(text).toContain("1");
    });

    it("should display Tools count equal to the number of tool-call spans", () => {
      const llm = makeLLMSpan();
      const tool = makeToolSpan();
      wrapper = mountThreadView({ spans: [llm, tool] });
      const text = wrapper.find(".thread-summary").text();
      expect(text).toContain("Tools");
      expect(text).toContain("1");
    });

    it("should display zero Tools when no tool spans are present", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const chips = wrapper.findAll(".thread-chip");
      const toolChip = chips.find((c) => c.text().includes("Tools"));
      expect(toolChip).toBeDefined();
      expect(toolChip!.text()).toContain("0");
    });

    it("should display the dominant model name in the Model chip", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const text = wrapper.find(".thread-summary").text();
      expect(text).toContain("gpt-4");
    });

    it("should not render the Model chip when no LLM-turn spans exist", () => {
      wrapper = mountThreadView({ spans: [makeRootSpan()] });
      // No llm_turn spans → dominantModel is "" → chip is hidden
      const modelChip = wrapper.find(".thread-chip--model");
      expect(modelChip.exists()).toBe(false);
    });

    it("should not render the Error chip when errorCount is 0", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan({ span_status: "UNSET" })] });
      const errorChip = wrapper.find(".thread-chip--error");
      expect(errorChip.exists()).toBe(false);
    });

    it("should render the Error chip when at least one span has ERROR status", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ span_status: "ERROR" })],
      });
      const errorChip = wrapper.find(".thread-chip--error");
      expect(errorChip.exists()).toBe(true);
      expect(errorChip.text()).toContain("Errors");
    });

    it("should display Duration chip with a non-empty value when spans exist", () => {
      // The default makeLLMSpan has start→end delta of 500_000_000 ns = 500 ms
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const durationChip = wrapper.find(".thread-chip--duration");
      expect(durationChip.exists()).toBe(true);
      expect(durationChip.text()).toContain("500ms");
    });

    it("should display Duration chip as '0ms' when spans is empty", () => {
      wrapper = mountThreadView({ spans: [] });
      const durationChip = wrapper.find(".thread-chip--duration");
      expect(durationChip.text()).toContain("0ms");
    });

    it("should display Cost as '$0' when spans have no cost data", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan({ gen_ai_usage_cost: undefined })] });
      const costChip = wrapper.find(".thread-chip--cost");
      expect(costChip.text()).toContain("$0");
    });

    it("should display a non-zero formatted cost when spans carry cost data", () => {
      // gen_ai_usage_cost: "0.002" → formatCost returns "$0.0020" (< $0.01 → 4 decimal places)
      wrapper = mountThreadView({ spans: [makeLLMSpan({ gen_ai_usage_cost: "0.002" })] });
      const costChip = wrapper.find(".thread-chip--cost");
      expect(costChip.text()).toContain("$0.0020");
    });
  });

  // =========================================================================
  // Conversation body — user query, assistant reply, system prompt
  // =========================================================================

  describe("conversation body", () => {
    it("should render the user query bubble when a user message is present", () => {
      const llm = makeLLMSpan();
      wrapper = mountThreadView({ spans: [llm] });
      const userBubble = wrapper.find(".thread-bubble--user");
      expect(userBubble.exists()).toBe(true);
      expect(userBubble.text()).toContain("Hello, world!");
    });

    it("should render the assistant reply bubble", () => {
      const llm = makeLLMSpan();
      wrapper = mountThreadView({ spans: [llm] });
      const assistantBubble = wrapper.find(".thread-bubble--assistant");
      expect(assistantBubble.exists()).toBe(true);
      expect(assistantBubble.text()).toContain("Hi there!");
    });

    it("should render the system prompt section when the first turn carries a system message", () => {
      const llm = makeLLMSpan({
        gen_ai_input_messages: JSON.stringify([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hi!" },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      const systemSection = wrapper.find(".thread-system");
      expect(systemSection.exists()).toBe(true);
      expect(systemSection.text()).toContain("System");
    });

    it("should not render system prompt section when no system message exists", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const systemSection = wrapper.find(".thread-system");
      expect(systemSection.exists()).toBe(false);
    });

    it("should show system prompt preview text collapsed by default", () => {
      const llm = makeLLMSpan({
        gen_ai_input_messages: JSON.stringify([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hi!" },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      // The content div is hidden by default (showSystemFull starts false)
      const content = wrapper.find(".thread-system__content");
      expect(content.exists()).toBe(false);
    });

    it("should expand the full system prompt when the system header is clicked", async () => {
      const sysText = "You are a helpful assistant.";
      const llm = makeLLMSpan({
        gen_ai_input_messages: JSON.stringify([
          { role: "system", content: sysText },
          { role: "user", content: "Hi!" },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      const head = wrapper.find(".thread-system__head");
      await head.trigger("click");
      const content = wrapper.find(".thread-system__content");
      expect(content.exists()).toBe(true);
      expect(content.text()).toContain(sysText);
    });

    it("should collapse the system prompt when the header is clicked a second time", async () => {
      const llm = makeLLMSpan({
        gen_ai_input_messages: JSON.stringify([
          { role: "system", content: "System instructions." },
          { role: "user", content: "Hi!" },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      const head = wrapper.find(".thread-system__head");
      await head.trigger("click"); // expand
      await head.trigger("click"); // collapse
      const content = wrapper.find(".thread-system__content");
      expect(content.exists()).toBe(false);
    });

    it("should render the timeline rail when LLM turns are present", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const rail = wrapper.find(".thread-rail");
      expect(rail.exists()).toBe(true);
    });

    it("should render one turn row per LLM span", () => {
      const llm1 = makeLLMSpan({ span_id: "llm-a", start_time: BASE_TIME_NS });
      const llm2 = makeLLMSpan({
        span_id: "llm-b",
        start_time: BASE_TIME_NS + 1_000_000_000,
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "Follow-up?" },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm1, llm2] });
      const turns = wrapper.findAll(".thread-turn");
      expect(turns.length).toBe(2);
    });
  });

  // =========================================================================
  // Tool-call card — expand / collapse
  // =========================================================================

  describe("tool call cards", () => {
    function makeLinkedToolSpan(parentSpanId: string, overrides: Record<string, unknown> = {}) {
      return makeToolSpan({
        span_id: "span-tool-linked",
        reference_parent_span_id: parentSpanId,
        tool_name: "search_db",
        ...overrides,
      });
    }

    it("should render a tool call card when the turn has tool spans", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      const card = wrapper.find(".thread-tools-card");
      expect(card.exists()).toBe(true);
    });

    it("should display the tool call count in the card header", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      const header = wrapper.find(".thread-tools-card__header");
      expect(header.text()).toContain("1 Tool call");
    });

    it("should use pluralised label for multiple tool calls", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const t1 = makeLinkedToolSpan("llm-p", { span_id: "tool-1" });
      const t2 = makeLinkedToolSpan("llm-p", { span_id: "tool-2", tool_name: "write_file" });
      wrapper = mountThreadView({ spans: [llm, t1, t2] });
      const header = wrapper.find(".thread-tools-card__header");
      expect(header.text()).toContain("2 Tool calls");
    });

    it("should not show tool body by default (collapsed)", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      const body = wrapper.find(".thread-tool-body");
      expect(body.exists()).toBe(false);
    });

    it("should expand the tool body when the tool row is clicked", async () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      const row = wrapper.find(".thread-tool-row");
      await row.trigger("click");
      const body = wrapper.find(".thread-tool-body");
      expect(body.exists()).toBe(true);
    });

    it("should collapse the tool body on second click", async () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      const row = wrapper.find(".thread-tool-row");
      await row.trigger("click"); // expand
      await row.trigger("click"); // collapse
      const body = wrapper.find(".thread-tool-body");
      expect(body.exists()).toBe(false);
    });

    it("should show both Arguments and Result sections when expanded", async () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p", {
        gen_ai_input_messages: JSON.stringify({ q: "hello" }),
        gen_ai_output_messages: JSON.stringify({ result: "ok" }),
      });
      wrapper = mountThreadView({ spans: [llm, tool] });
      const row = wrapper.find(".thread-tool-row");
      await row.trigger("click");
      const labels = wrapper.findAll(".thread-tool-body__label");
      const labelTexts = labels.map((l) => l.text());
      expect(labelTexts.some((t) => t.includes("Arguments"))).toBe(true);
      expect(labelTexts.some((t) => t.includes("Result"))).toBe(true);
    });

    it("should emit span-selected with the tool span_id when the view button is clicked", async () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p", { span_id: "tool-xyz" });
      wrapper = mountThreadView({ spans: [llm, tool] });
      const viewBtn = wrapper.find(".thread-tool-row__view");
      await viewBtn.trigger("click");
      const emitted = wrapper.emitted("span-selected");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["tool-xyz"]);
    });

    it("should show ERROR pill when tool span has ERROR status", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p", { span_status: "ERROR" });
      wrapper = mountThreadView({ spans: [llm, tool] });
      const errorPill = wrapper.find(".thread-pill--error");
      expect(errorPill.exists()).toBe(true);
      expect(errorPill.text()).toContain("ERROR");
    });

    it("should show OK pill when tool span is not in error state", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p", { span_status: "UNSET" });
      wrapper = mountThreadView({ spans: [llm, tool] });
      const okPill = wrapper.find(".thread-pill--ok");
      expect(okPill.exists()).toBe(true);
    });
  });

  // =========================================================================
  // "View span" emit in turn footer
  // =========================================================================

  describe("turn footer — view span button", () => {
    it("should emit span-selected with the llm span_id when View span is clicked", async () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan({ span_id: "llm-abc" })] });
      const viewBtn = wrapper.find(".thread-turn__view-span");
      expect(viewBtn.exists()).toBe(true);
      await viewBtn.trigger("click");
      const emitted = wrapper.emitted("span-selected");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["llm-abc"]);
    });

    it("should render the turn footer for each LLM turn", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const footer = wrapper.find(".thread-turn__footer");
      expect(footer.exists()).toBe(true);
    });

    it("should display the error metric chip in the footer when the turn span has ERROR status", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ span_status: "ERROR" })],
      });
      const errorMetric = wrapper.find(".thread-metric--error");
      expect(errorMetric.exists()).toBe(true);
    });

    it("should not display the error metric chip when the turn span is not in error state", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ span_status: "UNSET" })],
      });
      const errorMetric = wrapper.find(".thread-metric--error");
      expect(errorMetric.exists()).toBe(false);
    });
  });

  // =========================================================================
  // Dark mode CSS class
  // =========================================================================

  describe("dark mode", () => {
    it("should not apply thread-view--dark class when theme is light", () => {
      wrapper = mountThreadView({ spans: [] });
      const root = wrapper.find(".thread-view");
      expect(root.classes()).not.toContain("thread-view--dark");
    });
  });

  // =========================================================================
  // Historical user count hint
  // =========================================================================

  describe("historical user message hint", () => {
    it("should show the historical-messages hint when the trace has prior user messages", () => {
      // Build a trace where inp0 has an extra user message that is NOT
      // the main userQuery — buildTraceGroup counts those as historical.
      const llm = makeLLMSpan({
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "Earlier question" },
          { role: "assistant", content: "Earlier answer" },
          { role: "user", content: "Hello, world!" }, // ← becomes userQuery
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      const prior = wrapper.find(".thread-prior");
      expect(prior.exists()).toBe(true);
      expect(prior.text()).toContain("earlier");
    });

    it("should not show the historical-messages hint when there are no prior messages", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      const prior = wrapper.find(".thread-prior");
      expect(prior.exists()).toBe(false);
    });
  });

  // =========================================================================
  // Multi-trace (session) rendering
  // =========================================================================

  describe("multi-trace session", () => {
    it("should render one trace group per distinct trace_id", () => {
      const llm1 = makeLLMSpan({ trace_id: "trace-A", span_id: "llm-A" });
      const llm2 = makeLLMSpan({
        trace_id: "trace-B",
        span_id: "llm-B",
        start_time: BASE_TIME_NS + 2_000_000_000,
      });
      wrapper = mountThreadView({ spans: [llm1, llm2] });
      // Two separate trace groups → two .thread-rail containers
      const rails = wrapper.findAll(".thread-rail");
      expect(rails.length).toBe(2);
    });
  });

  // =========================================================================
  // formatDuration — exercised through the Duration chip
  // =========================================================================

  describe("formatDuration (via Duration chip)", () => {
    it("should show '0ms' when all span times are 0", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ start_time: 0, end_time: 0 })],
      });
      const chip = wrapper.find(".thread-chip--duration");
      expect(chip.text()).toContain("0ms");
    });

    it("should format sub-millisecond durations with two decimal places", () => {
      // end - start = 500_000 ns = 0.5 ms → "0.50ms"
      wrapper = mountThreadView({
        spans: [
          makeLLMSpan({
            start_time: BASE_TIME_NS,
            end_time: BASE_TIME_NS + 500_000,
          }),
        ],
      });
      const chip = wrapper.find(".thread-chip--duration");
      // Should not say "0ms" for a finite but sub-1ms duration
      expect(chip.text()).not.toBe("Duration 0ms");
      expect(chip.text()).toMatch(/0\.\d+ms/);
    });

    it("should format millisecond-range durations without decimal places", () => {
      // 500 ms = 500_000_000 ns → "500ms"
      wrapper = mountThreadView({
        spans: [
          makeLLMSpan({
            start_time: BASE_TIME_NS,
            end_time: BASE_TIME_NS + 500_000_000,
          }),
        ],
      });
      const chip = wrapper.find(".thread-chip--duration");
      expect(chip.text()).toContain("500ms");
    });

    it("should format second-range durations with two decimal places followed by s", () => {
      // 2_000 ms = 2_000_000_000 ns → "2.00s"
      wrapper = mountThreadView({
        spans: [
          makeLLMSpan({
            start_time: BASE_TIME_NS,
            end_time: BASE_TIME_NS + 2_000_000_000,
          }),
        ],
      });
      const chip = wrapper.find(".thread-chip--duration");
      expect(chip.text()).toContain("2.00s");
    });
  });

  // =========================================================================
  // formatCost — exercised through the Cost chip
  // =========================================================================

  describe("formatCost (via Cost chip)", () => {
    it("should display $0 when cost is 0", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ gen_ai_usage_cost: "0" })],
      });
      expect(wrapper.find(".thread-chip--cost").text()).toContain("$0");
    });

    it("should display two decimal places for costs >= $1", () => {
      // $1.50
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ gen_ai_usage_cost: "1.5" })],
      });
      expect(wrapper.find(".thread-chip--cost").text()).toContain("$1.50");
    });

    it("should display three decimal places for costs in the $0.01–$1 range", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ gen_ai_usage_cost: "0.05" })],
      });
      expect(wrapper.find(".thread-chip--cost").text()).toContain("$0.050");
    });

    it("should display four decimal places for costs below $0.01", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ gen_ai_usage_cost: "0.005" })],
      });
      expect(wrapper.find(".thread-chip--cost").text()).toContain("$0.0050");
    });
  });

  // =========================================================================
  // toolGlyph — pick a unicode glyph per tool name
  // =========================================================================

  describe("toolGlyph (via tool row icon)", () => {
    // Each tuple: [tool_name, expected glyph].
    // Names are chosen so they uniquely trigger one branch in toolGlyph()
    // without accidentally matching an earlier higher-priority branch.
    const cases: [string, string][] = [
      ["search_records", "🔍"],      // includes "search"
      ["list_history", "📋"],        // includes "list"
      ["read_file", "📖"],           // includes "read"
      ["write_content", "✏"],       // includes "write"
      ["delete_item", "🗑"],         // includes "delete"
      ["nav_page", "🧭"],            // includes "nav"
      ["time_range_picker", "⏱"],   // includes "time"
      // "merged" must NOT also match "call"/"tool" (those are checked first)
      ["merged_spans", "∑"],         // includes "merged", no "call"/"tool"
      ["plan_skill", "🧩"],          // includes "skill"
      ["schema_inspect", "🗄"],      // includes "schema"
    ];

    cases.forEach(([toolName, glyph]) => {
      it(`should display ${glyph} for tool name "${toolName}"`, () => {
        const llm = makeLLMSpan({ span_id: "llm-p" });
        const tool = makeToolSpan({
          span_id: `tool-${toolName}`,
          reference_parent_span_id: "llm-p",
          tool_name: toolName,
        });
        const w = mountThreadView({ spans: [llm, tool] });
        const iconEl = w.find(".thread-tool-row__icon");
        expect(iconEl.text()).toBe(glyph);
        w.unmount();
      });
    });

    // "unrecognised" name — must contain none of the keyword substrings
    // (schema, list, search, query, sql, read, get, fetch, write, edit,
    //  create, delete, remove, tool, call, nav, time, range, merged, skill, plan)
    it("should display ▸ for an unrecognised tool name", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeToolSpan({
        span_id: "tool-unknown",
        reference_parent_span_id: "llm-p",
        tool_name: "my_custom_operation",
      });
      const w = mountThreadView({ spans: [llm, tool] });
      expect(w.find(".thread-tool-row__icon").text()).toBe("▸");
      w.unmount();
    });
  });

  // =========================================================================
  // Prop: selectedSpanId (accepted but doesn't drive internal state)
  // =========================================================================

  describe("selectedSpanId prop", () => {
    it("should mount without errors when selectedSpanId is provided", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ span_id: "llm-abc" })],
        selectedSpanId: "llm-abc",
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount without errors when selectedSpanId is not provided", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
