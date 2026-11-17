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

// @vitest-environment jsdom
import { computed, defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobSpendEstimate } from "./useJobSpendEstimate";

const { executeQueryOnce } = vi.hoisted(() => ({ executeQueryOnce: vi.fn() }));

vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQueryOnce }),
}));

const NOW = 30 * 24 * 3_600_000;

describe("useJobSpendEstimate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    executeQueryOnce.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("leaves the estimate unknown, not 0, when the traffic query fails", async () => {
    executeQueryOnce.mockRejectedValue(new Error("400"));
    let estimate!: ReturnType<typeof useJobSpendEstimate>["estimate"];
    mount(
      defineComponent({
        setup() {
          ({ estimate } = useJobSpendEstimate({
            stream: ref("llm"),
            where: ref(""),
            ready: ref(true),
            scope: computed(() => "trace" as const),
            fields: ref<string[]>([]),
            judgeIds: ref<string[]>([]),
            rate: ref(1),
          }));
          return () => h("div");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(estimate.value.matchedPerDay).toBeNull();
  });

  it("cannot estimate sessions on a stream without a session column, and does not query", async () => {
    let estimate!: ReturnType<typeof useJobSpendEstimate>["estimate"];
    mount(
      defineComponent({
        setup() {
          ({ estimate } = useJobSpendEstimate({
            stream: ref("llm"),
            where: ref(""),
            ready: ref(true),
            scope: computed(() => "session" as const),
            fields: ref(["trace_id"]),
            judgeIds: ref<string[]>([]),
            rate: ref(1),
          }));
          return () => h("div");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(executeQueryOnce).not.toHaveBeenCalled();
    expect(estimate.value.matchedPerDay).toBeNull();
  });

  it("waits for the schema before counting sessions, without calling them unknown", async () => {
    executeQueryOnce.mockResolvedValue([{ cnt: 5 }]);
    const fields = ref<string[] | null>(null);
    let estimate!: ReturnType<typeof useJobSpendEstimate>["estimate"];
    let loading!: ReturnType<typeof useJobSpendEstimate>["loading"];
    mount(
      defineComponent({
        setup() {
          ({ estimate, loading } = useJobSpendEstimate({
            stream: ref("llm"),
            where: ref(""),
            ready: ref(true),
            scope: computed(() => "session" as const),
            fields,
            judgeIds: ref<string[]>([]),
            rate: ref(1),
          }));
          return () => h("div");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(executeQueryOnce).not.toHaveBeenCalled();
    expect(loading.value).toBe(true);
    expect(estimate.value.matchedPerDay).not.toBeNull();

    fields.value = ["gen_ai_conversation_id"];
    await vi.advanceTimersByTimeAsync(400);
    expect(executeQueryOnce.mock.calls[0][0]).toContain("NULLIF(\"gen_ai_conversation_id\", '')");
    expect(loading.value).toBe(false);
    expect(estimate.value.matchedPerDay).toBe(5);
  });
});
