// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import securityIntel, { classifyValues } from "./securityIntel";
import http from "./http";

vi.mock("./http", () => ({ default: vi.fn() }));

const post = vi.fn();

beforeEach(() => {
  post.mockReset();
  vi.mocked(http).mockReturnValue({ post } as never);
});

describe("securityIntel", () => {
  it("sends only the sweep fields of each indicator", async () => {
    post.mockResolvedValue({ data: {} });
    await securityIntel.sweep(
      "org",
      [
        {
          indicator: "1.2.3.4",
          type: "ip",
          severity: "high",
          confidence: 80,
          table: "ioc_x",
          source: "secret note",
        } as never,
      ],
      [{ name: "vpc" }],
      { start: 1, end: 2 },
    );
    expect(post).toHaveBeenCalledWith(
      "/api/org/security/intel/sweep",
      {
        indicators: [
          { indicator: "1.2.3.4", type: "ip", severity: "high", confidence: 80, table: "ioc_x" },
        ],
        streams: [{ name: "vpc" }],
        start_time: 1,
        end_time: 2,
      },
      { signal: undefined },
    );
  });

  it("classifies cells through the validate endpoint, skipping an empty request", async () => {
    expect(await classifyValues("org", [])).toEqual([]);
    expect(post).not.toHaveBeenCalled();
    post.mockResolvedValue({
      data: { values: [null], parsed: null, max_indicators: 5000, room: 5000 },
    });
    expect(await classifyValues("org", ["???"])).toEqual([null]);
    expect(post).toHaveBeenCalledWith("/api/org/security/intel/validate", { values: ["???"] });
  });
});
