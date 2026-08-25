// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUEST_TEMPLATE,
  RESERVED_HEADERS,
  TEMPLATE_PLACEHOLDERS,
  canEditRemoteTask,
  parseSampleInput,
  parseSampleMetadata,
  placeholderToken,
  prettyJson,
  remoteTaskState,
  remoteTaskVersionLabel,
} from "./remoteTaskContent";
import type { RemoteTask } from "@/services/remote-tasks.service";

function task(overrides: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id: "row-1",
    orgId: "acme",
    entityId: "head-1",
    version: 2,
    isDraft: false,
    isReferenceable: true,
    taskRef: "summarizer@2",
    name: "summarizer",
    endpoint: "https://tasks.example.com/run",
    httpMethod: "POST",
    auth: { type: "none", usesSecret: false },
    customHeaders: [],
    contentType: "application/json",
    responseSchema: "$.output",
    timeoutMs: 60_000,
    maxAttempts: 3,
    maxConcurrency: 4,
    signing: { enabled: false, usesSecret: false },
    verificationStatus: "verified",
    isActive: true,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("remoteTaskState", () => {
  it("reads as published only when an experiment could actually pin it", () => {
    expect(remoteTaskState(task())).toBe("published");
  });

  // A retired head keeps whatever its last test said, so "is it usable" has to
  // beat "did it pass" in BOTH directions — otherwise a deleted task reads as
  // Published, or as a failure someone might try to fix.
  it.each(["verified", "failed", "unverified"] as const)(
    "lets a retired head win over a %s status",
    (verificationStatus) => {
      expect(remoteTaskState(task({ isActive: false, verificationStatus }))).toBe("retired");
    },
  );

  it("separates a never-published draft from a failed test", () => {
    expect(remoteTaskState(task({ isDraft: true, version: 0, isReferenceable: false }))).toBe(
      "draft",
    );
    expect(
      remoteTaskState(
        task({ isDraft: true, version: 0, isReferenceable: false, verificationStatus: "failed" }),
      ),
    ).toBe("failed");
  });

  it("refuses to call a published-but-unreferenceable row published", () => {
    expect(remoteTaskState(task({ isReferenceable: false }))).toBe("draft");
  });
});

describe("remoteTaskVersionLabel", () => {
  it("labels a published row and offers nothing for a draft", () => {
    expect(remoteTaskVersionLabel(task())).toBe("v2");
    expect(remoteTaskVersionLabel(task({ isDraft: true, version: 0 }))).toBeNull();
  });
});

describe("canEditRemoteTask", () => {
  it("allows a task the platform can round-trip", () => {
    expect(canEditRemoteTask(task())).toBe(true);
  });

  // Every one of these holds a write-only secret reference the client is never
  // given, so re-sending the spec would drop or invalidate it.
  it.each([
    ["auth", { auth: { type: "bearer" as const, usesSecret: true } }],
    ["signing", { signing: { enabled: true, usesSecret: true } }],
    ["a header", { customHeaders: [{ key: "x-api-key", usesSecret: true }] }],
  ])("refuses a task whose %s holds a secret", (_label, overrides) => {
    expect(canEditRemoteTask(task(overrides as Partial<RemoteTask>))).toBe(false);
  });

  it("refuses a retired head", () => {
    expect(canEditRemoteTask(task({ isActive: false }))).toBe(false);
  });
});

describe("template vocabulary", () => {
  // The renderer rejects an unknown placeholder outright, so the form must not
  // offer one the server would refuse — and must never offer the answer key.
  it("offers only placeholders the renderer resolves", () => {
    expect(TEMPLATE_PLACEHOLDERS).toContain("input");
    expect(TEMPLATE_PLACEHOLDERS).toContain("context.row_id");
    expect(TEMPLATE_PLACEHOLDERS.some((name) => name.includes("expected"))).toBe(false);
    for (const name of TEMPLATE_PLACEHOLDERS) {
      expect(name === "input" || name === "metadata" || name.startsWith("context")).toBe(true);
    }
  });

  it("never puts the reference answer in the default body", () => {
    expect(DEFAULT_REQUEST_TEMPLATE).not.toContain("expected");
  });

  it("wraps a placeholder in the braces the renderer looks for", () => {
    expect(placeholderToken("input")).toBe("{{input}}");
  });

  it("lists every header the platform sets itself", () => {
    expect([...RESERVED_HEADERS]).toEqual([
      "authorization",
      "content-type",
      "traceparent",
      "tracestate",
      "x-o2-idempotency-key",
      "x-o2-signature",
    ]);
  });
});

describe("sample parsing", () => {
  it("sends JSON as JSON and prose as a string", () => {
    expect(parseSampleInput('{"q": 1}')).toEqual({ q: 1 });
    expect(parseSampleInput("what is 2 + 2")).toBe("what is 2 + 2");
    expect(parseSampleInput("   ")).toBe("");
  });

  it("only accepts an object as metadata", () => {
    expect(parseSampleMetadata('{"lang":"en"}')).toEqual({ lang: "en" });
    expect(parseSampleMetadata("[1,2]")).toBeUndefined();
    expect(parseSampleMetadata("not json")).toBeUndefined();
    expect(parseSampleMetadata("")).toBeUndefined();
  });
});

describe("prettyJson", () => {
  it("formats JSON text and leaves non-JSON alone", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("plain")).toBe("plain");
    expect(prettyJson(null)).toBe("—");
  });
});
