// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import type { Provider, Scorer } from "@/services/online-evals.service";
import { checkRunProviders, runProviderIds } from "./experimentProviderCheck";
import { experimentCostDisplay } from "./experimentDiscovery";

const judge = (entityId: string, providerId: string) =>
  ({
    id: entityId,
    entityId,
    name: entityId,
    scorerType: "llm_judge",
    params: { provider_id: providerId },
  }) as unknown as Scorer;
const codeScorer = {
  id: "code",
  entityId: "code",
  name: "code",
  scorerType: "code",
} as unknown as Scorer;
const provider = (id: string, name: string) =>
  ({ id, name, providerType: "openai", defaultModel: "m" }) as Provider;

describe("runProviderIds", () => {
  it("tests the task provider first, then each distinct judge provider", () => {
    expect(
      runProviderIds({
        taskType: "inline_prompt",
        providerId: "task-p",
        scorerIds: ["a", "b", "code"],
        scorers: [judge("a", "judge-p"), judge("b", "task-p"), codeScorer],
      }),
    ).toEqual(["task-p", "judge-p"]);
  });

  it("leaves the task provider out of a Remote Task run", () => {
    expect(
      runProviderIds({
        taskType: "remote",
        providerId: "task-p",
        scorerIds: ["a"],
        scorers: [judge("a", "judge-p")],
      }),
    ).toEqual(["judge-p"]);
  });
});

describe("checkRunProviders", () => {
  it("reports the first failing provider with the server reason", async () => {
    const test = vi.fn(async (_payload, id: string) => {
      if (id === "task-p") {
        throw { response: { data: { message: "Provider connection test failed" } } };
      }
      return "ok";
    });
    const failure = await checkRunProviders(
      ["task-p", "judge-p"],
      [provider("task-p", "acme-internal"), provider("judge-p", "openai")],
      test,
      "task-p",
    );
    expect(test).toHaveBeenCalledTimes(2);
    expect(test.mock.calls[0][0].authConfig).toEqual({ api_key: "" });
    expect(failure).toEqual({
      providerId: "task-p",
      providerName: "acme-internal",
      task: true,
      message: "Provider connection test failed",
    });
  });

  it("passes when every provider answers and fails on an unknown provider", async () => {
    const test = vi.fn(async () => "ok");
    expect(await checkRunProviders(["p"], [provider("p", "p")], test)).toBeNull();
    const missing = await checkRunProviders(["gone"], [], test);
    expect(missing?.providerId).toBe("gone");
    expect(test).toHaveBeenCalledTimes(1);
  });

  it("does not fail a provider missing from a list that could not be loaded", async () => {
    const test = vi.fn(async () => "ok");
    expect(await checkRunProviders(["gone"], [], test, null, false)).toBeNull();
    expect(test).not.toHaveBeenCalled();
    // Providers present in the fallback list are still tested, and still fail.
    const down = vi.fn(async () => {
      throw new Error("down");
    });
    const failure = await checkRunProviders(["p"], [provider("p", "p")], down, "p", false);
    expect(failure?.providerId).toBe("p");
  });
});

describe("experimentCostDisplay", () => {
  it("never shows an incomplete zero as a price", () => {
    expect(experimentCostDisplay(0.12, false)).toEqual({ kind: "exact", value: 0.12 });
    expect(experimentCostDisplay(0.12, true)).toEqual({ kind: "atLeast", value: 0.12 });
    expect(experimentCostDisplay(0, true)).toEqual({ kind: "unknown" });
    expect(experimentCostDisplay(null, true)).toEqual({ kind: "unknown" });
    expect(experimentCostDisplay(null, false)).toEqual({ kind: "none" });
  });
});
