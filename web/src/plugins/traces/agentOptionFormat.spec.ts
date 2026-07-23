// Copyright 2026 OpenObserve Inc.
import { describe, it, expect } from "vitest";
import { formatAgentOption, buildAgentSelectOptions } from "./agentOptionFormat";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

const a = (o: Partial<GenAiAgentListItem>): GenAiAgentListItem => ({
  name: "sre_agent",
  id: null,
  source_stream: "s",
  source_stream_type: "traces",
  env: null,
  version: null,
  ...o,
});

describe("formatAgentOption", () => {
  it("appends env and version when present", () => {
    expect(
      formatAgentOption(a({ id: "id-1", env: "prod", version: "1.2.0" })),
    ).toBe("sre_agent (id-1) · prod · v1.2.0");
  });
  it("omits missing segments", () => {
    expect(formatAgentOption(a({ env: "prod" }))).toBe("sre_agent · prod");
    expect(formatAgentOption(a({}))).toBe("sre_agent");
  });
});

describe("buildAgentSelectOptions", () => {
  it("groups variants under one header per agent", () => {
    const opts = buildAgentSelectOptions(
      [
        a({ env: "prod", version: "1.2.0" }),
        a({ env: "prod", version: "1.3.0" }),
      ],
      (k: string) => k,
    );
    expect(opts.filter((o: any) => o.header)).toHaveLength(1);
    expect(opts.filter((o: any) => !o.header)).toHaveLength(2);
  });
});
