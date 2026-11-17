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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper, config } from "@vue/test-utils";
import { computed } from "vue";
import i18n from "@/locales";

import ThreadView from "./ThreadView.vue";
import { attributeSteps, REQUEST_TIMELINE_KEY } from "./timeAttribution";

// The lanes query correlation and metrics; the strip's own logic is under test here.
vi.mock("./TraceLanes.vue", () => ({
  default: { name: "TraceLanes", template: '<div data-test="trace-lanes-stub" />' },
}));

// Install the real app i18n for every mount in this file so the migrated
// useI18n() calls in ThreadView.vue resolve real translations.
config.global.plugins = [...(config.global.plugins ?? []), i18n];

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
    gen_ai_input_messages: JSON.stringify([{ role: "user", content: "Hello, world!" }]),
    gen_ai_output_messages: JSON.stringify([{ role: "assistant", content: "Hi there!" }]),
    gen_ai_response_model: "gpt-4",
    gen_ai_usage_cost: "0.002",
    gen_ai_usage_total_tokens: "150",
    start_time: BASE_TIME_NS,
    end_time: BASE_TIME_NS + 500_000_000, // 500 ms later
    duration: 500_000, // µs, as stored
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
    duration: 200_000, // µs
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

    const toolChipValue = () => wrapper.find(".thread-chip--tools .thread-chip__value").text();

    it("should display Tools count equal to the number of tool cards", () => {
      const llm = makeLLMSpan();
      const tool = makeToolSpan();
      wrapper = mountThreadView({ spans: [llm, tool] });
      expect(toolChipValue()).toBe("1");
      expect(wrapper.findAll(".thread-tool-row")).toHaveLength(1);
    });

    // The chip counts the cards drawn, including calls with no tool span.
    it("counts tool calls recorded without a tool span, as the cards do", () => {
      const llm = makeLLMSpan({
        gen_ai_output_messages: JSON.stringify([
          {
            role: "assistant",
            parts: [
              { type: "tool_call", id: "c1", name: "search_web", arguments: {} },
              { type: "tool_call", id: "c2", name: "read_file", arguments: {} },
            ],
          },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      expect(wrapper.findAll(".thread-tool-row")).toHaveLength(2);
      expect(toolChipValue()).toBe("2");
    });

    // A tool span that wraps the only model call starts before it.
    it("shows and counts a tool span that starts before the first model call", () => {
      const llm = makeLLMSpan({ reference_parent_span_id: "outer" });
      const outer = makeToolSpan({
        span_id: "outer",
        tool_name: "outer_task",
        start_time: BASE_TIME_NS - 200_000_000,
      });
      const inner = makeToolSpan({ span_id: "inner", tool_name: "inner_lookup" });
      wrapper = mountThreadView({ spans: [llm, outer, inner] });
      const names = wrapper.findAll(".thread-tool-row__name").map((n) => n.text());
      expect(names).toEqual(["outer_task", "inner_lookup"]);
      expect(toolChipValue()).toBe("2");
    });

    it("should display zero Tools when no tool spans are present", () => {
      wrapper = mountThreadView({ spans: [makeLLMSpan()] });
      expect(toolChipValue()).toBe("0");
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
      expect(durationChip.text()).toContain("500.00ms");
    });

    it("should display Duration chip as '0us' when spans is empty", () => {
      wrapper = mountThreadView({ spans: [] });
      const durationChip = wrapper.find(".thread-chip--duration");
      expect(durationChip.text()).toContain("0us");
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
        gen_ai_input_messages: JSON.stringify([{ role: "user", content: "Follow-up?" }]),
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

    it("should render a tool call thread when the turn has tool spans", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      expect(wrapper.find(".thread-tools-thread").exists()).toBe(true);
    });

    it("shows the cards without a Show calls pill", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const t1 = makeLinkedToolSpan("llm-p", { span_id: "tool-1" });
      const t2 = makeLinkedToolSpan("llm-p", { span_id: "tool-2", tool_name: "write_file" });
      wrapper = mountThreadView({ spans: [llm, t1, t2] });
      expect(wrapper.find(".tt-toggle").exists()).toBe(false);
      expect(wrapper.findAll(".thread-tool-row")).toHaveLength(2);
    });

    // Issue #3135: `span.duration` is µs. A 3.51 s LLM call and a 10.10 ms
    // tool call must read as the waterfall shows them.
    it("shows per-turn and per-tool durations from a real µs span as the waterfall does", () => {
      const llm = makeLLMSpan({
        span_id: "llm-p",
        end_time: BASE_TIME_NS + 3_510_000_000,
        duration: 3_510_000,
      });
      const tool = makeLinkedToolSpan("llm-p", {
        end_time: BASE_TIME_NS + 110_100_000,
        duration: 10_100,
      });
      wrapper = mountThreadView({ spans: [llm, tool] });

      const turnMetric = wrapper.find('.thread-metric[title="Duration"]');
      expect(turnMetric.text()).toContain("3.51s");
      expect(wrapper.find(".thread-pill").text()).toContain("10.10ms");
    });

    it("opens the first call and every failed call; the rest show one summary line", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const first = makeLinkedToolSpan("llm-p", {
        span_id: "tool-1",
        start_time: BASE_TIME_NS + 1,
      });
      const ok = makeLinkedToolSpan("llm-p", { span_id: "tool-2", start_time: BASE_TIME_NS + 2 });
      const failed = makeLinkedToolSpan("llm-p", {
        span_id: "tool-3",
        start_time: BASE_TIME_NS + 3,
        span_status: "ERROR",
      });
      wrapper = mountThreadView({ spans: [llm, first, ok, failed] });
      const cards = wrapper.findAll(".thread-tool");
      expect(cards.map((c) => c.classes().includes("thread-tool--open"))).toEqual([
        true,
        false,
        true,
      ]);
    });

    it("should collapse an open card when its row is clicked, and reopen it", async () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p");
      wrapper = mountThreadView({ spans: [llm, tool] });
      const row = wrapper.find(".thread-tool-row");
      expect(wrapper.find(".thread-tool-body").exists()).toBe(true);
      await row.trigger("click");
      expect(wrapper.find(".thread-tool-body").exists()).toBe(false);
      await row.trigger("click");
      expect(wrapper.find(".thread-tool-body").exists()).toBe(true);
    });

    it("should show both Arguments and Result sections when expanded", () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p", {
        gen_ai_input_messages: JSON.stringify({ q: "hello" }),
        gen_ai_output_messages: JSON.stringify({ result: "ok" }),
      });
      wrapper = mountThreadView({ spans: [llm, tool] });
      const labelTexts = wrapper.findAll(".thread-tool-body__label").map((l) => l.text());
      expect(labelTexts.some((t) => t.includes("Arguments"))).toBe(true);
      expect(labelTexts.some((t) => t.includes("Result"))).toBe(true);
    });

    it("cuts a long result at 6 lines with the full text one click away", async () => {
      const llm = makeLLMSpan({ span_id: "llm-p" });
      const tool = makeLinkedToolSpan("llm-p", {
        span_id: "tool-long",
        gen_ai_output_messages: JSON.stringify({ lines: Array.from({ length: 12 }, (_, i) => i) }),
      });
      wrapper = mountThreadView({ spans: [llm, tool] });
      const more = wrapper.find("[data-test='thread-tool-show-json-tool-long']");
      expect(more.exists()).toBe(true);
      await more.trigger("click");
      expect(wrapper.find("[data-test='thread-tool-show-json-tool-long']").exists()).toBe(false);
    });

    it("draws a tool_call part with no execute_tool span as a card without a status", () => {
      const llm = makeLLMSpan({
        span_id: "llm-p",
        gen_ai_output_messages: JSON.stringify([
          {
            role: "assistant",
            parts: [{ type: "tool_call", id: "call_1", name: "grep", arguments: { q: "x" } }],
          },
        ]),
      });
      wrapper = mountThreadView({ spans: [llm] });
      const row = wrapper.find(".thread-tool-row");
      expect(row.text()).toContain("grep");
      expect(wrapper.find(".thread-pill").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Called grep");
      // No span means no result was recorded, not an empty result.
      expect(wrapper.text()).toContain("No result recorded");
      expect(wrapper.text()).not.toContain("(empty)");
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
      expect(wrapper.find(".thread-pill--ok").exists()).toBe(true);
    });
  });

  describe("behind this step", () => {
    const llm = makeLLMSpan({ span_id: "llm-p" });
    const failed = makeToolSpan({
      span_id: "tool-x",
      reference_parent_span_id: "llm-p",
      gen_ai_tool_name: "search_db",
      span_status: "ERROR",
    });

    function mountWithTimeline(spans: any[]) {
      const steps = attributeSteps(spans);
      const timeline = {
        steps: computed(() => new Map(steps.map((step) => [step.spanId, step]))),
        spans: computed(() => spans),
        streamName: computed(() => "default"),
        openLogsAt: vi.fn(),
        openInWaterfall: vi.fn(),
      };
      wrapper = mount(ThreadView, {
        props: { spans },
        global: { provide: { [REQUEST_TIMELINE_KEY as symbol]: timeline } },
      });
      return timeline;
    }

    it("explains a failed tool call and opens it in the waterfall", async () => {
      const timeline = mountWithTimeline([llm, failed]);
      const strip = wrapper.find('[data-test="behind-this-step-tool-x"]');
      expect(strip.exists()).toBe(true);
      expect(strip.find('[data-test="behind-this-step-sentence"]').text()).toBe(
        "search_db failed after 200.00ms. The step itself held the time, not a child span.",
      );
      await strip.find('[data-test="behind-this-step-open-waterfall"]').trigger("click");
      expect(timeline.openInWaterfall).toHaveBeenCalledWith("tool-x");
    });

    it("leaves a quick, healthy turn alone", () => {
      mountWithTimeline([llm]);
      expect(wrapper.find('[data-test^="behind-this-step"]').exists()).toBe(false);
    });

    it("shows nothing outside the trace view", () => {
      wrapper = mountThreadView({ spans: [llm, failed] });
      expect(wrapper.find('[data-test^="behind-this-step"]').exists()).toBe(false);
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
  // Duration formatting — exercised through the Duration chip
  // =========================================================================

  describe("duration formatting (via Duration chip)", () => {
    it("should show '0us' when all span times are 0", () => {
      wrapper = mountThreadView({
        spans: [makeLLMSpan({ start_time: 0, end_time: 0 })],
      });
      const chip = wrapper.find(".thread-chip--duration");
      expect(chip.text()).toContain("0us");
    });

    it("should format sub-millisecond durations in microseconds", () => {
      // end - start ≈ 500_000 ns ≈ 500 µs (BASE_TIME_NS exceeds float precision)
      wrapper = mountThreadView({
        spans: [
          makeLLMSpan({
            start_time: BASE_TIME_NS,
            end_time: BASE_TIME_NS + 500_000,
          }),
        ],
      });
      const chip = wrapper.find(".thread-chip--duration");
      expect(chip.text()).toMatch(/\d{3}\.\d{2}us/);
    });

    it("should format millisecond-range durations with two decimal places", () => {
      // 500 ms = 500_000_000 ns → "500.00ms"
      wrapper = mountThreadView({
        spans: [
          makeLLMSpan({
            start_time: BASE_TIME_NS,
            end_time: BASE_TIME_NS + 500_000_000,
          }),
        ],
      });
      const chip = wrapper.find(".thread-chip--duration");
      expect(chip.text()).toContain("500.00ms");
    });

    it("computes the total duration over 200,000 spans without a RangeError", () => {
      const spans: Record<string, unknown>[] = Array.from({ length: 200_000 }, (_, i) => ({
        trace_id: "trace-001",
        span_id: `plain-${i}`,
        span_kind: "1",
        start_time: 1_000_000_000 + i,
        end_time: 1_000_000_001 + i,
      }));
      spans[0] = makeLLMSpan({ start_time: 1_000_000_000, end_time: 1_500_000_000 });
      spans[199_999] = { ...spans[199_999], end_time: 3_000_000_000 };
      wrapper = mountThreadView({ spans });
      expect(wrapper.find(".thread-chip--duration").text()).toContain("2.00s");
    }, 60_000);

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
