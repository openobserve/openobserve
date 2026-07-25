// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, vi } from "vitest";

const getMock = vi.fn();

vi.mock("./http", () => ({
  default: () => ({
    get: getMock,
  }),
}));

import genAiAgentMappingService from "./gen-ai-agent-mapping.service";

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

    await genAiAgentMappingService.listVersionsForCompare(
      "org",
      "checkout-agent",
      null,
      nowMicros,
    );

    expect(getMock).toHaveBeenCalledWith("/api/org/gen_ai/agents", {
      params: {
        start_time: nowMicros - 2_592_000_000_000,
        end_time: nowMicros,
      },
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
