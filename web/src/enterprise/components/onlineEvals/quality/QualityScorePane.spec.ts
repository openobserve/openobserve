// @vitest-environment jsdom
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type { QualityScore } from "@/services/online-evals.service";
import QualityScorePane from "./QualityScorePane.vue";

const { push, traceDetails } = vi.hoisted(() => ({
  push: vi.fn(() => Promise.resolve()),
  traceDetails: vi.fn(),
}));

vi.mock("@/services/search", () => ({ default: { get_trace_details: traceDetails } }));

// The real box renders; only the heavy content renderer is replaced.
vi.mock("@/plugins/traces/LLMContentRenderer.vue", () => ({
  default: {
    name: "LLMContentRenderer",
    props: ["content"],
    template: `<div class="llm">{{ content }}</div>`,
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "aiEvaluations", query: {} }),
  useRouter: () => ({ push }),
}));

const score = (overrides: Partial<QualityScore> = {}): QualityScore => ({
  id: "s1",
  timestamp: 1791199632199574,
  refTimestamp: 1791199600000000,
  sourceType: "llm_judge",
  targetScope: "trace",
  targetId: "70d86ea9c0ffee",
  spanId: null,
  traceId: "70d86ea9c0ffee",
  sessionId: null,
  sourceStream: "default",
  sourceStreamType: "traces",
  value: "medium",
  unhealthy: true,
  reasoning: "The answer ignores the format the user asked for.",
  evaluatorTraceId: "eval-trace-1",
  taskId: null,
  inputPreview: "Write VRL to parse JSON from my nginx logs.",
  outputPreview: null,
  ...overrides,
});

const DrawerStub = defineComponent({
  name: "AddToDatasetDrawer",
  props: ["open", "orgId", "refType", "refId", "sourceStream", "refTraceStartTime", "inputPreview"],
  emits: ["update:open"],
  template: `<div data-test="dataset-drawer-stub" />`,
});

const hits = (spans: Record<string, unknown>[]) => Promise.resolve({ data: { hits: spans } });
const WINDOW = {
  start_time: 1791199600000000 - 3_600_000_000,
  end_time: 1791199600000000 + 3_600_000_000,
};
const io = (wrapper: ReturnType<typeof mountPane>) =>
  wrapper.findAll('[data-test="quality-score-pane-io"] .llm').map((box) => box.text());
const skeletons = (wrapper: ReturnType<typeof mountPane>) =>
  (["input", "output"] as const).filter((side) =>
    wrapper.find(`[data-test="ai-review-content-skeleton-${side}"]`).exists(),
  );
const unavailable = (wrapper: ReturnType<typeof mountPane>) =>
  wrapper.find('[data-test="quality-score-pane-full-unavailable"]');

function mountPane(props: Record<string, unknown> = {}) {
  return mount(QualityScorePane, {
    props: {
      score: score(),
      thresholdLabel: "high",
      canPrev: false,
      canNext: true,
      loading: false,
      ...props,
    },
    global: { plugins: [store, withQueryClient()], stubs: { AddToDatasetDrawer: DrawerStub } },
  });
}

describe("QualityScorePane", () => {
  beforeEach(() => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    push.mockClear();
    traceDetails.mockReset().mockImplementation(() => hits([]));
  });

  it("shows the health and the rule, but no target link, value or time", () => {
    const header = mountPane().find('[data-test="quality-score-pane-header"]');
    expect(header.text()).toContain("Unhealthy");
    expect(header.find('[data-test="quality-score-pane-rule"]').text()).toBe("Healthy if high");
    expect(header.find('[data-test="quality-score-pane-target"]').exists()).toBe(false);
    expect(header.text()).not.toContain("70d86ea9");
    expect(header.text()).not.toContain("Trace");
    expect(header.text()).not.toContain("medium");
    expect(header.text()).not.toMatch(/\d{4}-\d{2}-\d{2}|ago/);
  });

  it("says when no threshold is set, without a health tag", () => {
    const header = mountPane({
      score: score({ unhealthy: null }),
      thresholdLabel: "",
    }).find('[data-test="quality-score-pane-header"]');
    expect(header.find('[data-test="quality-score-pane-health"]').exists()).toBe(false);
    expect(header.text()).toContain("No healthy threshold set");
  });

  it("shows Input and Output side by side, with the missing output said inside its box", () => {
    // A session score never fetches, so its preview shows at once.
    const io = mountPane({
      score: score({ targetScope: "session", sessionId: "sess-1", targetId: "sess-1" }),
    }).find('[data-test="quality-score-pane-io"]');
    expect(io.classes()).toEqual(expect.arrayContaining(["flex-1", "md:flex-row"]));
    expect(io.find(".llm").text()).toBe("Write VRL to parse JSON from my nginx logs.");
    expect(io.find('[data-test="ai-review-content-empty-output"]').text()).toBe(
      "Output not captured",
    );
    expect(io.find('[data-test="ai-review-content-empty-input"]').exists()).toBe(false);
  });

  it("shows the reasoning in a bordered collapsible block, open by default", () => {
    const block = mountPane().find('[data-test="quality-score-pane-reasoning"]');
    expect(block.classes()).toEqual(
      expect.arrayContaining(["border", "border-border-default", "rounded-default"]),
    );
    expect(block.find("button").text()).toBe("Reasoning");
    expect(block.find('[data-test="quality-score-pane-reasoning-text"]').text()).toBe(
      "The answer ignores the format the user asked for.",
    );
  });

  it("folds and unfolds the reasoning, and keeps it folded across scores", async () => {
    const wrapper = mountPane();
    const toggle = () =>
      wrapper.find('[data-test="quality-score-pane-reasoning"] button').trigger("click");
    await toggle();
    expect(wrapper.find('[data-test="quality-score-pane-reasoning-text"]').exists()).toBe(false);
    await wrapper.setProps({ score: score({ id: "s2", reasoning: "Second reasoning." }) });
    expect(wrapper.text()).not.toContain("Second reasoning.");
    await toggle();
    expect(wrapper.find('[data-test="quality-score-pane-reasoning-text"]').text()).toBe(
      "Second reasoning.",
    );
  });

  it("says so inside the reasoning block when the judge gave none", () => {
    const wrapper = mountPane({ score: score({ reasoning: null }) });
    expect(wrapper.find('[data-test="quality-score-pane-no-reasoning"]').text()).toBe(
      "No reasoning recorded",
    );
  });

  it("opens the target and the evaluator trace from the footer in the same tab", async () => {
    const wrapper = mountPane();
    const trace = {
      name: "traceDetails",
      query: {
        org_identifier: "default",
        from: 1791199600000000 - 3_600_000_000,
        to: 1791199600000000 + 3_600_000_000,
        stream: "default",
        trace_id: "70d86ea9c0ffee",
      },
    };
    await wrapper.find('[data-test="quality-score-pane-open-target"]').trigger("click");
    expect(push).toHaveBeenLastCalledWith(trace);
    await wrapper.find('[data-test="quality-score-pane-open-evaluator"]').trigger("click");
    expect(push).toHaveBeenLastCalledWith({
      name: "traceDetails",
      query: {
        org_identifier: "default",
        stream: "_evaluator",
        trace_id: "eval-trace-1",
        from: 1791199632199574 - 3_600_000_000,
        to: 1791199632199574 + 3_600_000_000,
      },
    });
    expect(window.open).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="quality-score-pane-open-target"]').text()).toBe("Open trace");
  });

  it("opens a session score on the session page in the same tab", async () => {
    const wrapper = mountPane({
      score: score({
        targetScope: "session",
        sessionId: "sess-1",
        traceId: null,
        targetId: "sess-1",
      }),
    });
    await wrapper.find('[data-test="quality-score-pane-open-target"]').trigger("click");
    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "sessionDetails",
        query: expect.objectContaining({ session_id: "sess-1" }),
      }),
    );
    expect(wrapper.find('[data-test="quality-score-pane-open-target"]').text()).toBe(
      "Open session",
    );
  });

  it("hides an action whose link cannot be built", () => {
    const wrapper = mountPane({ score: score({ evaluatorTraceId: null }) });
    expect(wrapper.find('[data-test="quality-score-pane-open-evaluator"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-score-pane-open-target"]').exists()).toBe(true);
  });

  it("adds a trace score to a dataset in a drawer on the page, without an expected output", async () => {
    const wrapper = mountPane();
    expect(wrapper.findComponent(DrawerStub).exists()).toBe(false);
    const button = wrapper.find('[data-test="quality-score-pane-add-to-dataset"]');
    expect(button.text()).toBe("Add to dataset");
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    const drawer = wrapper.findComponent(DrawerStub);
    expect(drawer.props()).toEqual({
      open: true,
      orgId: "default",
      refType: "trace",
      refId: "70d86ea9c0ffee",
      sourceStream: "default",
      refTraceStartTime: 1791199600000000,
      inputPreview: undefined,
    });
    expect(push).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();

    // A closed drawer unmounts, so the next open starts from the score then selected.
    drawer.vm.$emit("update:open", false);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(DrawerStub).exists()).toBe(false);
  });

  it("adds a span score by its span id", async () => {
    const wrapper = mountPane({
      score: score({ targetScope: "span", targetId: "span-9", spanId: "span-9" }),
    });
    await wrapper.find('[data-test="quality-score-pane-add-to-dataset"]').trigger("click");
    expect(wrapper.findComponent(DrawerStub).props()).toEqual(
      expect.objectContaining({
        refType: "span",
        refId: "span-9",
        sourceStream: "default",
        refTraceStartTime: 1791199600000000,
      }),
    );
  });

  it("shows Add to dataset disabled with the reason for a session score", async () => {
    const wrapper = mountPane({
      score: score({ targetScope: "session", sessionId: "sess-1", targetId: "sess-1" }),
    });
    const button = wrapper.find('[data-test="quality-score-pane-add-to-dataset"]');
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.findComponent({ name: "OTooltip" }).props("content")).toBe(
      "Datasets take a single trace or span. Open the session to add one of its traces.",
    );
    await button.trigger("click");
    expect(wrapper.findComponent(DrawerStub).exists()).toBe(false);
  });

  it("disables Add to dataset when the score has no source stream", async () => {
    const wrapper = mountPane({ score: score({ sourceStream: null }) });
    const button = wrapper.find('[data-test="quality-score-pane-add-to-dataset"]');
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.findComponent({ name: "OTooltip" }).props("content")).toBe(
      "This score has no source stream to add from.",
    );
    await button.trigger("click");
    expect(wrapper.findComponent(DrawerStub).exists()).toBe(false);
  });

  it("shows skeletons in both boxes while the trace loads, then the span score's full text", async () => {
    let resolve: (value: unknown) => void = () => {};
    traceDetails.mockReturnValue(new Promise((done) => (resolve = done)));
    const wrapper = mountPane({
      score: score({ targetScope: "span", spanId: "span-2", targetId: "span-2" }),
    });
    await flushPromises();
    expect(traceDetails).toHaveBeenCalledWith({
      org_identifier: "default",
      stream_name: "default",
      trace_id: "70d86ea9c0ffee",
      ...WINDOW,
      hint_ts: 1791199600000000,
    });
    // While loading: a skeleton in each box, the frames kept, no preview and no note.
    expect(skeletons(wrapper)).toEqual(["input", "output"]);
    expect(io(wrapper)).toEqual([]);
    expect(wrapper.text()).not.toContain("Write VRL to parse JSON");
    expect(wrapper.find('[data-test="ai-review-content-copy-input"]').exists()).toBe(true);
    expect(unavailable(wrapper).exists()).toBe(false);

    resolve({
      data: {
        hits: [
          { span_id: "span-1", gen_ai_input_messages: "Other span", gen_ai_output_messages: "x" },
          {
            span_id: "span-2",
            gen_ai_input_messages: "Write VRL to parse JSON from my nginx logs. Full prompt.",
            gen_ai_output_messages: "parse_json!(.message)",
          },
        ],
      },
    });
    await flushPromises();
    expect(io(wrapper)).toEqual([
      "Write VRL to parse JSON from my nginx logs. Full prompt.",
      "parse_json!(.message)",
    ]);
    expect(unavailable(wrapper).exists()).toBe(false);
    expect(skeletons(wrapper)).toEqual([]);
  });

  it("reads a trace score from the root chat span, as the scorer does", async () => {
    traceDetails.mockImplementation(() =>
      hits([
        { span_id: "tool", _timestamp: 1, gen_ai_tool_name: "search", gen_ai_input_messages: "q" },
        { span_id: "child", _timestamp: 2, parent_span_id: "root", gen_ai_input_messages: "Child" },
        {
          span_id: "root",
          _timestamp: 3,
          parent_span_id: "",
          gen_ai_input_messages: "Root question",
          gen_ai_output_messages: "Root answer",
        },
      ]),
    );
    const wrapper = mountPane();
    await flushPromises();
    expect(io(wrapper)).toEqual(["Root question", "Root answer"]);
  });

  it("keeps the preview and says the full text is not available when the fetch fails or finds no LLM span", async () => {
    traceDetails.mockRejectedValue(new Error("boom"));
    const failed = mountPane();
    await flushPromises();
    expect(io(failed)).toEqual(["Write VRL to parse JSON from my nginx logs."]);
    expect(unavailable(failed).text()).toBe("Full text not available");
    expect(skeletons(failed)).toEqual([]);

    traceDetails
      .mockReset()
      .mockImplementation(() => hits([{ span_id: "x", service_name: "api" }]));
    const empty = mountPane();
    await flushPromises();
    expect(io(empty)).toEqual(["Write VRL to parse JSON from my nginx logs."]);
    expect(unavailable(empty).text()).toBe("Full text not available");
  });

  it("does not fetch for a session score or a score without a source stream", async () => {
    const session = mountPane({
      score: score({ targetScope: "session", sessionId: "sess-1", targetId: "sess-1" }),
    });
    const noStream = mountPane({ score: score({ sourceStream: null }) });
    await flushPromises();
    expect(traceDetails).not.toHaveBeenCalled();
    for (const wrapper of [session, noStream]) {
      expect(io(wrapper)).toEqual(["Write VRL to parse JSON from my nginx logs."]);
      expect(skeletons(wrapper)).toEqual([]);
      expect(unavailable(wrapper).exists()).toBe(false);
    }
    expect(session.find('[data-test="quality-score-pane-open-target"]').text()).toBe(
      "Open session",
    );
  });

  it("fetches a trace once for every score on it, coming back included", async () => {
    traceDetails.mockImplementation(() =>
      hits([
        { span_id: "root", parent_span_id: "", gen_ai_input_messages: "Root question" },
        { span_id: "span-2", parent_span_id: "root", gen_ai_input_messages: "Span question" },
      ]),
    );
    const wrapper = mountPane();
    await flushPromises();
    expect(io(wrapper)[0]).toBe("Root question");
    await wrapper.setProps({
      score: score({
        id: "s2",
        targetScope: "span",
        spanId: "span-2",
        targetId: "span-2",
        refTimestamp: 1791199600000000 + 5_000_000,
      }),
    });
    await flushPromises();
    expect(io(wrapper)[0]).toBe("Span question");
    await wrapper.setProps({ score: score() });
    await flushPromises();
    expect(io(wrapper)[0]).toBe("Root question");
    expect(traceDetails).toHaveBeenCalledTimes(1);
  });

  it("keeps the frame and shows skeletons in the header, both boxes and the reasoning while the scores page loads", async () => {
    const wrapper = mountPane({ score: null, loading: true, canNext: false });
    await flushPromises();
    expect(wrapper.find('[data-test="quality-score-pane-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-score-pane-header-skeleton"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="quality-score-pane-health"]').exists()).toBe(false);
    expect(skeletons(wrapper)).toEqual(["input", "output"]);
    const reasoning = wrapper.find('[data-test="quality-score-pane-reasoning"]');
    expect(reasoning.find('[data-test="quality-score-pane-reasoning-skeleton"]').exists()).toBe(
      true,
    );
    expect(reasoning.text()).not.toContain("No reasoning recorded");
    expect(wrapper.find('[data-test="quality-score-pane-add-to-dataset"]').exists()).toBe(false);
    expect(traceDetails).not.toHaveBeenCalled();

    // The page lands: the score shows and the skeletons go, the trace text then loads.
    await wrapper.setProps({ score: score({ sourceStream: null }), loading: false });
    expect(wrapper.find('[data-test="quality-score-pane-header-skeleton"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-score-pane-reasoning-skeleton"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="quality-score-pane-reasoning-text"]').exists()).toBe(true);
    expect(skeletons(wrapper)).toEqual([]);
  });

  it("emits previous and next, and disables what cannot move", async () => {
    const wrapper = mountPane();
    expect(
      wrapper.find('[data-test="quality-score-pane-prev"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.find('[data-test="quality-score-pane-next"]').trigger("click");
    expect(wrapper.emitted("next")).toHaveLength(1);
  });

  it("shows a placeholder without a selected score", () => {
    const wrapper = mountPane({ score: null });
    expect(wrapper.find('[data-test="quality-score-pane-empty"]').text()).toContain(
      "No score selected",
    );
  });
});
