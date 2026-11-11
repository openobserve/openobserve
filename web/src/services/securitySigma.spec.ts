// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import http from "@/services/http";
import securitySigma, {
  type CompiledSigma,
  type SigmaCompileResponse,
} from "@/services/securitySigma";
import { normalizeCompileResponse, securitySigmaKeys } from "@/services/securitySigma.queries";

vi.mock("@/services/http", () => ({ default: vi.fn() }));

describe("securitySigma service", () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    client = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
    };
    vi.mocked(http).mockReturnValue(client as any);
  });

  it("reads the catalog and the coverage, and compiles with a POST body", async () => {
    await securitySigma.catalog("acme");
    expect(client.get).toHaveBeenCalledWith("/api/acme/security/sigma/catalog");
    await securitySigma.coverage("acme");
    expect(client.get).toHaveBeenCalledWith("/api/acme/security/mitre/coverage");
    const body = { rule_id: "r1", source_type: "aws_cloudtrail", stream: "ct" };
    await securitySigma.compile("acme", body);
    expect(client.post).toHaveBeenCalledWith("/api/acme/security/sigma/compile", body);
  });

  it("keys a compile by its whole request, under the org", () => {
    const a = securitySigmaKeys.compile("acme", { rule_id: "r1", fields: ["a"] });
    const b = securitySigmaKeys.compile("acme", { rule_id: "r1", fields: ["b"] });
    expect(a.slice(0, 2)).toEqual(["org", "acme"]);
    expect(a).not.toEqual(b);
  });
});

describe("normalizeCompileResponse", () => {
  const compiled = (runnable: boolean): CompiledSigma => ({
    where: runnable ? "x = 1" : "",
    runnable,
    unsupported: [],
    assumedAbsent: [],
    fields: [],
  });
  const response = (over: Partial<SigmaCompileResponse>): SigmaCompileResponse => ({
    rule: null,
    compiled: null,
    correlation: null,
    applies: true,
    ocsfBridge: null,
    applicable: [],
    parseError: null,
    ...over,
  });

  it("folds each applicable rule's reason and SQL into its compile", () => {
    const out = normalizeCompileResponse(
      response({
        applicable: [
          { key: "a", runnable: false, reason: "No column user_name", compiled: compiled(false) },
          { key: "b", runnable: true, sql: "SELECT 1", compiled: compiled(true) },
        ],
      }),
    );
    expect(out.applicable[0].compiled.reason).toBe("No column user_name");
    expect(out.applicable[1].compiled.sql).toBe("SELECT 1");
  });

  it("folds the named rule's SQL into its compile and tolerates a server without it", () => {
    expect(
      normalizeCompileResponse(response({ compiled: compiled(true), sql: "SELECT 2" })).compiled
        ?.sql,
    ).toBe("SELECT 2");
    const bare = normalizeCompileResponse(response({ compiled: compiled(true) }));
    expect(bare.compiled?.sql).toBeUndefined();
    expect(bare.compiled?.reason).toBeUndefined();
  });
});
