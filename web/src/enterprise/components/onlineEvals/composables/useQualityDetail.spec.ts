// @vitest-environment jsdom
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type {
  QualityScore,
  QualityScorePage,
  QualityScoresParams,
} from "@/services/online-evals.service";
import type { QualityOnly, QualityScope } from "../utils/qualityFormat";

const { scores } = vi.hoisted(() => ({ scores: vi.fn() }));

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, quality: { list: vi.fn(), scores, failedRuns: vi.fn() } },
  };
});

import { SCORES_PAGE_SIZE, useQualityDetail } from "./useQualityDetail";

let TOTAL = 25;
/** Scores written since the first read, which push the older ones down the list. */
let NEW_SCORES = 0;

const score = (index: number): QualityScore => ({
  id: `s${index}`,
  timestamp: index,
  refTimestamp: index,
  sourceType: "llm_judge",
  targetScope: "trace",
  targetId: `t${index}`,
  spanId: null,
  traceId: `t${index}`,
  sessionId: null,
  sourceStream: "default",
  sourceStreamType: "traces",
  value: 0.5,
  unhealthy: false,
  reasoning: null,
  evaluatorTraceId: null,
  taskId: null,
  inputPreview: null,
  outputPreview: null,
});

function page(params: QualityScoresParams): QualityScorePage {
  const from = params.from ?? 0;
  const size = params.size ?? 20;
  const list = Array.from({ length: Math.max(0, Math.min(size, TOTAL - from)) }, (_, i) =>
    score(from + i - NEW_SCORES),
  );
  return {
    average: 0.5,
    distribution: [
      { key: 0, lower: 0, upper: 0.5, count: 15, unhealthy: 6 },
      { key: 1, lower: 0.5, upper: 1, count: 10, unhealthy: 0 },
    ],
    list,
    total: TOTAL,
    from,
    size,
  };
}

function mountDetail(
  options: { initial?: { page: number; scoreId: string | null }; enabled?: boolean } = {},
) {
  const state = {
    configId: ref("cfg-1"),
    scope: ref<QualityScope>("all"),
    only: ref<QualityOnly>("all"),
    dateWindow: ref({ startUs: 10, endUs: 20 }),
    agentParams: ref<Record<string, string>>({}),
    enabled: ref(options.enabled ?? true),
  };
  let api!: ReturnType<typeof useQualityDetail>;
  const Host = defineComponent({
    setup() {
      api = useQualityDetail({ ...state, initial: options.initial });
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [store, withQueryClient()] } });
  return { state, api: () => api };
}

const lastParams = () => scores.mock.calls[scores.mock.calls.length - 1][2] as QualityScoresParams;

describe("useQualityDetail", () => {
  beforeEach(() => {
    TOTAL = 25;
    NEW_SCORES = 0;
    scores.mockReset().mockImplementation((_org, _id, params) => Promise.resolve(page(params)));
  });

  it("asks for the first page of 10 and takes the counts from distribution[]", async () => {
    const { api } = mountDetail();
    await flushPromises();
    expect(scores).toHaveBeenCalledWith("default", "cfg-1", {
      start_time: 10,
      end_time: 20,
      from: 0,
      size: SCORES_PAGE_SIZE,
    });
    expect(api().summary.value).toEqual({ total: 25, unhealthy: 6, status: "attention" });
    expect(api().selected.value?.id).toBe("s0");
  });

  it("sends scope, only, the bucket filter and the page", async () => {
    const { state, api } = mountDetail();
    await flushPromises();
    state.scope.value = "trace";
    state.only.value = "unhealthy";
    api().filter.value = { kind: "bucket", from: 0, to: 1 };
    api().setPage(1);
    await flushPromises();
    expect(lastParams()).toEqual({
      start_time: 10,
      end_time: 20,
      scope: "trace",
      unhealthy_only: true,
      bucket_from: 0,
      bucket_to: 1,
      from: 10,
      size: SCORES_PAGE_SIZE,
    });
    api().filter.value = { kind: "value", value: "medium" };
    await flushPromises();
    expect(lastParams()).toMatchObject({ value: "medium", from: 0 });
    expect(lastParams()).not.toHaveProperty("bucket_from");
  });

  it("resets the page and the selection on a scope, filter or config change", async () => {
    const { state, api } = mountDetail();
    await flushPromises();
    const moveAway = async () => {
      api().setPage(2);
      await flushPromises();
      api().select("s23");
      expect(api().selected.value?.id).toBe("s23");
    };
    const expectReset = async () => {
      expect(api().page.value).toBe(0);
      await flushPromises();
      expect(api().selected.value?.id).toBe("s0");
    };

    await moveAway();
    api().filter.value = { kind: "bucket", from: 1, to: 1 };
    await expectReset();

    await moveAway();
    state.scope.value = "trace";
    // A scope change also drops the bucket filter.
    expect(api().filter.value).toBeNull();
    await expectReset();

    await moveAway();
    api().filter.value = { kind: "bucket", from: 0, to: 0 };
    state.configId.value = "cfg-2";
    expect(api().filter.value).toBeNull();
    await expectReset();

    await moveAway();
    state.only.value = "unhealthy";
    await expectReset();
  });

  it("keeps the page and the selected score when a Refresh moves the window", async () => {
    const { state, api } = mountDetail();
    await flushPromises();
    api().setPage(1);
    await flushPromises();
    api().select("s13");
    // Two scores arrive and the window moves to now: s13 slides two rows down the same page.
    NEW_SCORES = 2;
    state.dateWindow.value = { startUs: 70_000_000, endUs: 80_000_000 };
    await flushPromises();
    expect(lastParams()).toMatchObject({ start_time: 70_000_000, from: 10 });
    expect(api().page.value).toBe(1);
    expect(api().selected.value?.id).toBe("s13");
    expect(api().list.value.indexOf(api().selected.value!)).toBe(5);
  });

  it("steps back to the last page when a shorter window leaves the page past the end", async () => {
    const { state, api } = mountDetail();
    await flushPromises();
    api().setPage(2);
    await flushPromises();
    TOTAL = 12;
    state.dateWindow.value = { startUs: 70_000_000, endUs: 80_000_000 };
    await flushPromises();
    expect(api().page.value).toBe(1);
    expect(lastParams().from).toBe(10);
  });

  it("moves to the next page on the last row and back to the last row of the previous page", async () => {
    const { api } = mountDetail();
    await flushPromises();
    api().select("s9");
    expect(api().selected.value?.id).toBe("s9");
    api().next();
    await flushPromises();
    expect(lastParams().from).toBe(10);
    expect(api().selected.value?.id).toBe("s10");
    api().prev();
    await flushPromises();
    expect(api().selected.value?.id).toBe("s9");
  });

  it("stops at the last score", async () => {
    const { api } = mountDetail();
    await flushPromises();
    api().setPage(2);
    await flushPromises();
    api().select("s24");
    expect(api().selected.value?.id).toBe("s24");
    expect(api().canNext.value).toBe(false);
    api().next();
    expect(api().selected.value?.id).toBe("s24");
  });

  it("reopens the page and the score from the URL", async () => {
    const { api } = mountDetail({ initial: { page: 1, scoreId: "s13" } });
    await flushPromises();
    expect(scores).toHaveBeenCalledTimes(1);
    expect(lastParams().from).toBe(10);
    expect(api().selected.value?.id).toBe("s13");
  });

  it("falls back to the first row when the restored score is not on the page", async () => {
    const { api } = mountDetail({ initial: { page: 1, scoreId: "s99" } });
    await flushPromises();
    expect(api().selected.value?.id).toBe("s10");
  });

  it("keeps a restored page while the agent levels are restored before the first read", async () => {
    const { state, api } = mountDetail({ initial: { page: 2, scoreId: "s21" }, enabled: false });
    state.agentParams.value = { agent_name: "alpha" };
    state.enabled.value = true;
    await flushPromises();
    expect(scores).toHaveBeenCalledTimes(1);
    expect(lastParams()).toMatchObject({ agent_name: "alpha", from: 20 });
    expect(api().selected.value?.id).toBe("s21");
    // Once reading, an agent change starts the list over as before.
    state.agentParams.value = { agent_name: "beta" };
    expect(api().page.value).toBe(0);
  });

  it("reports the status of a failed scores request", async () => {
    scores.mockReset().mockRejectedValue({ response: { status: 404 } });
    const { api } = mountDetail();
    await flushPromises();
    expect(api().errorStatus.value).toBe(404);
  });
});
