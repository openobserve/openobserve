// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  exceptionDefaults,
  exceptionPayload,
  makeExceptionSchema,
  splitValues,
} from "./SecurityDetectionExceptions.schema";

const t = (key: string) => key;

describe("detection exceptions form", () => {
  it("reads one value per line or comma, dropping blanks and repeats", () => {
    expect(splitValues(" 10.0.0.5 ,\n10.0.0.6\n\n10.0.0.5")).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  it("builds the request with explicit keys and an expiry from now", () => {
    const now = 1_800_000_000_000;
    const body = exceptionPayload(
      { ...exceptionDefaults("srcaddr", "10.0.0.5"), comment: " scanner ", expiryDays: 7 },
      now,
    );
    expect(body).toEqual({
      field: "srcaddr",
      operator: "equals",
      values: ["10.0.0.5"],
      comment: "scanner",
      expires_at: (now + 7 * 86_400_000) * 1000,
    });
    expect(exceptionPayload({ ...exceptionDefaults("a", "b"), expiryDays: 0 }).expires_at).toBe(
      null,
    );
  });

  it("needs a field, at least one value and a reason", () => {
    const schema = makeExceptionSchema(t);
    expect(schema.safeParse({ ...exceptionDefaults("a", ""), comment: "c" }).success).toBe(false);
    expect(schema.safeParse({ ...exceptionDefaults("", "v"), comment: "c" }).success).toBe(false);
    expect(schema.safeParse({ ...exceptionDefaults("a", "v"), comment: " " }).success).toBe(false);
    expect(schema.safeParse({ ...exceptionDefaults("a", "v"), comment: "c" }).success).toBe(true);
  });

  it("reads allowlist ids, not typed values, for in_list", () => {
    const schema = makeExceptionSchema(t);
    const base = { ...exceptionDefaults("srcaddr", "ignored"), operator: "in_list", comment: "c" };
    expect(schema.safeParse({ ...base, lists: [] }).success).toBe(false);
    expect(schema.safeParse({ ...base, values: "", lists: ["scanners"] }).success).toBe(true);
    const body = exceptionPayload({
      ...exceptionDefaults("srcaddr", "ignored"),
      operator: "in_list",
      lists: ["scanners", "svc", "scanners"],
      comment: "c",
    });
    expect(body.values).toEqual(["scanners", "svc"]);
    expect(body.operator).toBe("in_list");
  });
});
