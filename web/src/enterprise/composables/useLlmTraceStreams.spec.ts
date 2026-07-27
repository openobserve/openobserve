// @vitest-environment jsdom
// Tests for useLlmTraceStreams — the shared LLM trace-stream loader
// extracted verbatim from SessionsList.vue (loadTraceStreams /
// ensureStreamsLoaded). Behavior must stay byte-identical to the original:
//   • filters streams whose settings.is_llm_stream === false
//   • clamps the passed activeStream ref to the first available stream when
//     it's not already in the list
//   • on error: empties availableStreams, clears activeStream, still marks
//     streamsLoaded true
//   • ensureStreamsLoaded memoizes the in-flight/completed load promise

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

const getStreams = vi.fn();

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams }),
}));

import { useLlmTraceStreams } from "./useLlmTraceStreams";

beforeEach(() => {
  getStreams.mockReset();
});

describe("useLlmTraceStreams", () => {
  it("filters out streams with is_llm_stream === false and clamps activeStream", async () => {
    getStreams.mockResolvedValue({
      list: [
        { name: "a", settings: { is_llm_stream: true } },
        { name: "b", settings: { is_llm_stream: false } },
        { name: "c" },
      ],
    });

    const activeStream = ref("not-in-list");
    const { availableStreams, streamsLoaded, loadTraceStreams } = useLlmTraceStreams(activeStream);

    await loadTraceStreams();

    expect(availableStreams.value).toEqual(["a", "c"]);
    expect(streamsLoaded.value).toBe(true);
    expect(activeStream.value).toBe("a");
  });

  it("does not clamp activeStream when it's already in the list", async () => {
    getStreams.mockResolvedValue({
      list: [{ name: "a", settings: { is_llm_stream: true } }, { name: "c" }],
    });

    const activeStream = ref("c");
    const { loadTraceStreams } = useLlmTraceStreams(activeStream);

    await loadTraceStreams();

    expect(activeStream.value).toBe("c");
  });

  it("on rejection: empties availableStreams, clears activeStream, marks streamsLoaded", async () => {
    getStreams.mockRejectedValue(new Error("boom"));

    const activeStream = ref("whatever");
    const { availableStreams, streamsLoaded, loadTraceStreams } = useLlmTraceStreams(activeStream);

    await loadTraceStreams();

    expect(availableStreams.value).toEqual([]);
    expect(activeStream.value).toBe("");
    expect(streamsLoaded.value).toBe(true);
  });

  it("ensureStreamsLoaded memoizes the loader across multiple calls", async () => {
    getStreams.mockResolvedValue({ list: [{ name: "a" }] });

    const activeStream = ref("");
    const { ensureStreamsLoaded } = useLlmTraceStreams(activeStream);

    await Promise.all([ensureStreamsLoaded(), ensureStreamsLoaded()]);

    expect(getStreams).toHaveBeenCalledTimes(1);
  });
});
