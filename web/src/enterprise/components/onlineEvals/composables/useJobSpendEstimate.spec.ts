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
import { computed, defineComponent, h, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobSpendEstimate } from "./useJobSpendEstimate";

const { executeQueryOnce } = vi.hoisted(() => ({ executeQueryOnce: vi.fn() }));

vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQueryOnce }),
}));

const NOW = 30 * 24 * 3_600_000;
const DAY_US = 24 * 3_600_000_000;

describe("useJobSpendEstimate backfill count", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    executeQueryOnce.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("counts the matched targets over exactly the window the backfill queues from", async () => {
    executeQueryOnce.mockImplementation(async (sql: string) =>
      sql.includes("histogram") ? [{ cnt: 400 }] : [{ cnt: 66 }],
    );
    let backfillMatched!: Ref<number | null>;
    const backfillDays = ref(1);
    mount(
      defineComponent({
        setup() {
          ({ backfillMatched } = useJobSpendEstimate({
            stream: ref("llm"),
            where: ref("gen_ai_agent_name = 'a'"),
            ready: ref(true),
            scope: computed(() => "trace" as const),
            fields: ref<string[]>([]),
            judgeIds: ref<string[]>([]),
            rate: ref(1),
            backfillDays,
          }));
          return () => h("div");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(400);

    const backfill = executeQueryOnce.mock.calls.find(([sql]) => !sql.includes("histogram"))!;
    expect(backfill[0]).toContain('COUNT(DISTINCT "trace_id") AS cnt FROM "llm"');
    expect(backfill[0]).toContain("gen_ai_agent_name = 'a'");
    // Runs once the 400 ms debounce has passed: the last day up to then.
    const endUs = (NOW + 400) * 1000;
    expect(backfill.slice(1, 3)).toEqual([endUs - DAY_US, endUs]);
    expect(backfillMatched.value).toBe(66);

    backfillDays.value = 0;
    await vi.advanceTimersByTimeAsync(400);
    expect(backfillMatched.value).toBe(0);
  });

  it("leaves the estimate unknown, not 0, when the traffic query fails", async () => {
    executeQueryOnce.mockRejectedValue(new Error("400"));
    let estimate!: ReturnType<typeof useJobSpendEstimate>["estimate"];
    let backfillMatched!: Ref<number | null>;
    mount(
      defineComponent({
        setup() {
          ({ estimate, backfillMatched } = useJobSpendEstimate({
            stream: ref("llm"),
            where: ref(""),
            ready: ref(true),
            scope: computed(() => "trace" as const),
            fields: ref<string[]>([]),
            judgeIds: ref<string[]>([]),
            rate: ref(1),
            backfillDays: ref(1),
          }));
          return () => h("div");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(estimate.value.matchedPerDay).toBeNull();
    expect(backfillMatched.value).toBeNull();
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
