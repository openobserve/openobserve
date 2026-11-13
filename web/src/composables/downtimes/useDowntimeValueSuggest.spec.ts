// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import downtimes from "@/services/downtimes";
import type { DimensionCondition } from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { useDowntimeValueSuggest } from "./useDowntimeValueSuggest";
import { labelRows } from "@/components/shared/ServiceNameLabel.fixtures";

vi.mock("@/services/downtimes", () => ({ default: { values: vi.fn() } }));

const answer = (values: string[], partial = false) =>
  ({
    data: {
      values: values.map((v) => ({ value: v, source: "registry", items: 0 })),
      partial,
    },
  }) as any;

const pair = (key: string, value: string, operator: "=" | "!=" = "="): DimensionCondition => ({
  type: "pair",
  key,
  operator,
  value,
});

let scopes: EffectScope[] = [];

const make = (condition: DimensionCondition | null, org = "acme") => {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() =>
    useDowntimeValueSuggest(queryClient, ref(org), ref("planned"), ref(condition)),
  )!;
};

describe("useDowntimeValueSuggest", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.values).mockReset();
  });

  afterEach(() => {
    scopes.forEach((scope) => scope.stop());
    scopes = [];
    vi.useRealTimers();
  });

  it("hints on a chip whose exact value was not seen, and not on a seen or wildcard one", async () => {
    vi.useFakeTimers();
    vi.mocked(downtimes.values).mockImplementation(async (_org, query: any) =>
      answer(query.key === "host" ? ["node-1"] : ["payments-api"]),
    );
    const { isNotSeen } = make({
      type: "group",
      op: "and",
      items: [pair("service", "payments-api"), pair("host", "node-9"), pair("pod", "web*")],
    });
    await vi.advanceTimersByTimeAsync(300);
    await nextTick();
    expect(isNotSeen("host", ["node-9"])).toBe(true);
    expect(isNotSeen("service", ["payments-api"])).toBe(false);
    expect(isNotSeen("pod", ["web*"])).toBe(false);
  });

  it("asks for the typed prefix narrowed by the other rows' = pairs, in the downtime's folder", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer(["node-1", "node-2"]));
    const condition: DimensionCondition = {
      type: "group",
      op: "and",
      items: [pair("service", "payments-api"), pair("host", "old"), pair("env", "dev", "!=")],
    };
    const { loadValues } = make(condition);
    await expect(loadValues("host", " NODE* ")).resolves.toEqual(["node-1", "node-2"]);
    expect(downtimes.values).toHaveBeenCalledWith(
      "acme",
      {
        key: "host",
        prefix: "node",
        condition: {
          type: "group",
          op: "and",
          items: [{ type: "pair", key: "service", operator: "=", value: "payments-api" }],
        },
      },
      "planned",
    );
  });

  it("does not narrow through an OR group", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer([]));
    const { loadValues } = make({ type: "group", op: "or", items: [pair("service", "a")] });
    await loadValues("host", "");
    expect(vi.mocked(downtimes.values).mock.calls[0][1]).toMatchObject({ condition: null });
  });

  it("reports a partial answer", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer(["a"], true));
    const suggest = make(null);
    await suggest.loadValues("host", "");
    expect(suggest.partial.value).toBe(true);
  });

  it("asks nothing without an org or a key", async () => {
    await expect(make(null, "").loadValues("host", "")).resolves.toEqual([]);
    await expect(make(null).loadValues("", "")).resolves.toEqual([]);
    expect(downtimes.values).not.toHaveBeenCalled();
  });

  it("names a loaded service value by its display name and keeps the key as the value", async () => {
    const row = labelRows.differs;
    vi.mocked(downtimes.values).mockResolvedValue({
      data: {
        values: [
          { value: row.service_name, label: row.display_name, source: "registry", items: 2 },
          { value: "nats", source: "registry", items: 1 },
        ],
        partial: false,
      },
    } as any);
    const { loadValues, labelOf } = make(null);
    await expect(loadValues("service", "")).resolves.toEqual([row.service_name, "nats"]);
    expect(labelOf("service", row.service_name)).toBe(row.display_name);
    expect(labelOf("service", "nats")).toBeUndefined();
  });

  it("drops a slow answer from the org the user switched away from", async () => {
    let finishA: (v: unknown) => void = () => {};
    vi.mocked(downtimes.values).mockImplementation((org: string) =>
      org === "org-a"
        ? (new Promise((resolve) => (finishA = resolve)) as any)
        : Promise.resolve({
            data: {
              values: [{ value: "svc-b", label: "Service B", source: "registry", items: 1 }],
              partial: false,
            },
          } as any),
    );
    const org = ref("org-a");
    const scope = effectScope();
    scopes.push(scope);
    const suggest = scope.run(() =>
      useDowntimeValueSuggest(queryClient, org, ref("planned"), ref(null)),
    )!;
    const slow = suggest.loadValues("service", "");
    org.value = "org-b";
    await nextTick();
    await suggest.loadValues("service", "");
    finishA({
      data: {
        values: [{ value: "svc-a", label: "Service A", source: "registry", items: 1 }],
        partial: true,
      },
    });
    await slow;
    expect(suggest.labelOf("service", "svc-a")).toBeUndefined();
    expect(suggest.labelOf("service", "svc-b")).toBe("Service B");
    expect(suggest.partial.value).toBe(false);
  });
});
