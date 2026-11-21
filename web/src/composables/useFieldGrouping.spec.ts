// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));

const correlation = vi.hoisted(() => ({
  keyFields: Promise.resolve({}) as Promise<Record<string, unknown>>,
}));
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    loadSemanticGroups: vi.fn(async () => []),
    loadKeyFields: vi.fn(() => correlation.keyFields),
    loadFieldGrouping: vi.fn(async () => ({})),
  }),
}));

import useFieldGrouping from "./useFieldGrouping";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useFieldGrouping", () => {
  beforeEach(() => {
    correlation.keyFields = Promise.resolve({ logs: { fields: ["a"], groups: [] } });
  });

  it("loads the key fields of the stream type", async () => {
    const grouping = useFieldGrouping();
    await grouping.loadGroupingContext("logs");
    expect(grouping.contextLoaded.value).toBe(true);
    expect([...grouping.keyFieldSet.value]).toEqual(["a"]);
  });

  it("clears the context on reset and drops the answer of a load started before it", async () => {
    let resolveOld!: (value: Record<string, unknown>) => void;
    correlation.keyFields = new Promise((resolve) => {
      resolveOld = resolve;
    });
    const grouping = useFieldGrouping();
    const old = grouping.loadGroupingContext("logs");
    grouping.reset();
    correlation.keyFields = Promise.resolve({ logs: { fields: ["b"], groups: [] } });
    await grouping.loadGroupingContext("logs");
    expect([...grouping.keyFieldSet.value]).toEqual(["b"]);
    resolveOld({ logs: { fields: ["a"], groups: [] } });
    await old;
    await flush();
    expect([...grouping.keyFieldSet.value]).toEqual(["b"]);
    expect(grouping.contextLoaded.value).toBe(true);
  });

  it("lets the newest of two overlapping loads win", async () => {
    let resolveFirst!: (value: Record<string, unknown>) => void;
    correlation.keyFields = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const grouping = useFieldGrouping();
    const first = grouping.loadGroupingContext("logs");
    correlation.keyFields = Promise.resolve({ logs: { fields: ["new"], groups: [] } });
    await grouping.loadGroupingContext("logs");
    resolveFirst({ logs: { fields: ["stale"], groups: [] } });
    await first;
    expect([...grouping.keyFieldSet.value]).toEqual(["new"]);
  });
});
