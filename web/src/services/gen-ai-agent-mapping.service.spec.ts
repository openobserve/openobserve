// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, vi } from "vitest";

vi.mock("./http", () => ({
  default: () => ({
    get: vi.fn(async () => ({
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
    })),
  }),
}));

import genAiAgentMappingService from "./gen-ai-agent-mapping.service";

describe("listAgents", () => {
  it("surfaces env and version", async () => {
    const res = await genAiAgentMappingService.listAgents("org", 1, 2);
    expect(res.agents[0].env).toBe("production");
    expect(res.agents[0].version).toBe("1.2.0");
  });
});
