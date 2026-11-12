// Copyright 2026 OpenObserve Inc.
import { beforeEach, describe, it, expect, vi } from "vitest";

const getMock = vi.fn();
const putMock = vi.fn();
const postMock = vi.fn();

vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("./http", () => ({
  default: () => ({
    get: getMock,
    put: putMock,
    post: postMock,
  }),
}));

import genAiAgentMappingService, { HARNESS_STRIP_BATCH } from "./gen-ai-agent-mapping.service";
import analytics from "./product_analytics";

describe("listAgents", () => {
  it("surfaces env and version", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: "agent-a",
            id: "id-1",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.2.0",
          },
        ],
      },
    });
    const res = await genAiAgentMappingService.listAgents("org", 1, 2);
    expect(res.agents[0].env).toBe("production");
    expect(res.agents[0].version).toBe("1.2.0");
  });

  it("parses first_seen/last_seen when present, and null when absent", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: "agent-with-times",
            id: "id-2",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.2.0",
            first_seen: 1700000000000000,
            last_seen: 1700000100000000,
          },
          {
            name: "agent-without-times",
            id: "id-3",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.2.0",
          },
        ],
      },
    });
    const res = await genAiAgentMappingService.listAgents("org", 1, 2);
    expect(res.agents[0].first_seen).toBe(1700000000000000);
    expect(res.agents[0].last_seen).toBe(1700000100000000);
    expect(res.agents[1].first_seen).toBeNull();
    expect(res.agents[1].last_seen).toBeNull();
  });
});

describe("listVersionsForCompare", () => {
  const nowMicros = 1_700_000_000_000_000;

  it("uses a µs wide window (guards the RETENTION_MS off-by-1000)", async () => {
    getMock.mockResolvedValueOnce({ data: { agents: [] } });

    await genAiAgentMappingService.listVersionsForCompare("org", "checkout-agent", null, nowMicros);

    expect(getMock).toHaveBeenCalledWith("/api/org/gen_ai/agents", {
      params: {
        start_time: nowMicros - 2_592_000_000_000,
        end_time: nowMicros,
      },
    });
  });

  it("widens the window to the page start when the page window is longer than retention", async () => {
    const pageStart = nowMicros - 90 * 24 * 3600 * 1000 * 1000;
    getMock.mockResolvedValueOnce({ data: { agents: [] } });

    await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      null,
      nowMicros,
      pageStart,
    );

    expect(getMock).toHaveBeenLastCalledWith("/api/org/gen_ai/agents", {
      params: { start_time: pageStart, end_time: nowMicros },
    });
  });

  it("keeps the retention window when the page window is shorter", async () => {
    const pageStart = nowMicros - 7 * 24 * 3600 * 1000 * 1000;
    getMock.mockResolvedValueOnce({ data: { agents: [] } });

    await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      null,
      nowMicros,
      pageStart,
    );

    expect(getMock).toHaveBeenLastCalledWith("/api/org/gen_ai/agents", {
      params: { start_time: nowMicros - 2_592_000_000_000, end_time: nowMicros },
    });
  });

  it("returns versions outside the page window and excludes the version:null (UNSET) row", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.4.0",
            first_seen: nowMicros - 6 * 24 * 3600 * 1000 * 1000,
            last_seen: nowMicros - 5 * 24 * 3600 * 1000 * 1000,
          },
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.5.0",
            first_seen: nowMicros - 3600 * 1000 * 1000,
            last_seen: nowMicros,
          },
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: null,
          },
        ],
      },
    });

    const result = await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      null,
      nowMicros,
    );

    const versions = result.map((a) => a.version).sort();
    expect(versions).toEqual(["1.4.0", "1.5.0"]);
  });

  it("filters by agentName", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.4.0",
          },
          {
            name: "other-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "9.9.9",
          },
        ],
      },
    });

    const result = await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      null,
      nowMicros,
    );

    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("1.4.0");
  });

  it("filters by env when env is provided, and does not filter when env is null", async () => {
    getMock.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.4.0",
          },
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "staging",
            version: "1.5.0",
          },
        ],
      },
    });

    const scoped = await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      "production",
      nowMicros,
    );
    expect(scoped).toHaveLength(1);
    expect(scoped[0].env).toBe("production");

    getMock.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "production",
            version: "1.4.0",
          },
          {
            name: "checkout-agent",
            source_stream: "default",
            source_stream_type: "traces",
            env: "staging",
            version: "1.5.0",
          },
        ],
      },
    });

    const all = await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      null,
      nowMicros,
    );
    expect(all).toHaveLength(2);
  });
});

describe("save analytics", () => {
  beforeEach(() => vi.mocked(analytics.track).mockClear());

  it("tracks gen_ai_agent_mapping_saved once the server confirms", async () => {
    putMock.mockResolvedValueOnce({ data: {} });
    await genAiAgentMappingService.save("org", {} as any);
    expect(analytics.track).toHaveBeenCalledWith("gen_ai_agent_mapping_saved");
  });

  it("does not track when the save is rejected", async () => {
    putMock.mockRejectedValueOnce(new Error("boom"));
    await expect(genAiAgentMappingService.save("org", {} as any)).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});

describe("stripHarness", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  const echo = async (_url: string, body: { texts: string[] }) => ({
    data: {
      results: body.texts.map((text) => ({ text: text.toUpperCase(), hidden: 1, only: null })),
    },
  });

  it("posts the patterns and texts to the server and returns its results", async () => {
    postMock.mockImplementation(echo);
    const patterns = ["regex (?s)<env>.*?</env>"];
    const out = await genAiAgentMappingService.stripHarness("org", patterns, ["a", "b"]);
    expect(postMock).toHaveBeenCalledWith("/api/org/settings/gen_ai/harness_strip", {
      patterns,
      texts: ["a", "b"],
    });
    expect(out.map((r) => r.text)).toEqual(["A", "B"]);
  });

  it("splits texts into batches the server accepts and keeps their order", async () => {
    postMock.mockImplementation(echo);
    const texts = Array.from({ length: HARNESS_STRIP_BATCH + 2 }, (_, i) => `t${i}`);
    const out = await genAiAgentMappingService.stripHarness("org", ["tag job"], texts);
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls[1][1].texts).toEqual(texts.slice(HARNESS_STRIP_BATCH));
    expect(out.map((r) => r.text)).toEqual(texts.map((t) => t.toUpperCase()));
  });
});
