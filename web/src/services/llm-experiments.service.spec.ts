// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "./http";
import llmExperimentsService from "./llm-experiments.service";

vi.mock("./http", () => {
  const mockClient = { get: vi.fn(), post: vi.fn() };
  return { default: vi.fn(() => mockClient) };
});

const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.get.mockResolvedValue({ data: {} });
});

describe("llm-experiments compare()", () => {
  // The server owns the neutral threshold (0.05). Sending a client-side default
  // silently overrides it, and a 0 makes every movement a regression.
  it("omits the threshold entirely when the caller does not pick one", async () => {
    await llmExperimentsService.compare("acme", "base", "cand");

    const [, config] = mockClient.get.mock.calls[0];
    expect(config.params).toEqual({ baselineId: "base", candidateId: "cand" });
    expect("threshold" in config.params).toBe(false);
  });

  it("sends the threshold the caller picked, including zero", async () => {
    await llmExperimentsService.compare("acme", "base", "cand", 0.15);
    expect(mockClient.get.mock.calls[0][1].params.threshold).toBe(0.15);

    await llmExperimentsService.compare("acme", "base", "cand", 0);
    expect(mockClient.get.mock.calls[1][1].params.threshold).toBe(0);
  });
});
