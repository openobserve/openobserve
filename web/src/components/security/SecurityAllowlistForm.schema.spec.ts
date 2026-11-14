// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  allowlistDefaults,
  allowlistPayload,
  isIpOrCidr,
  makeAllowlistSchema,
  splitLines,
} from "./SecurityAllowlistForm.schema";

const t = (key: string, named?: Record<string, unknown>) =>
  named ? `${key} ${JSON.stringify(named)}` : key;

const valid = { id: "scanners", name: "Scanners", purpose: "scanner", values: "", description: "" };

describe("allowlist form", () => {
  it.each([
    ["10.0.0.5", true],
    ["10.0.0.0/8", true],
    ["0.0.0.0/0", true],
    ["2001:db8::1", true],
    ["2001:db8::/32", true],
    ["10.0.0.256", false],
    ["10.0.0.0/33", false],
    ["2001:db8::/129", false],
    ["10.0.0.0/8/1", false],
    ["svc-backup", false],
    ["dc01.corp", false],
  ])("checks %s as an IP or CIDR: %s", (value, ok) => {
    expect(isIpOrCidr(value)).toBe(ok);
  });

  it("reads one value per line, dropping blanks and repeats", () => {
    expect(splitLines(" a \n\nb\na")).toEqual(["a", "b"]);
  });

  it("takes an id of lowercase letters, digits, _ or - only", () => {
    const schema = makeAllowlistSchema(t);
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, id: "Scanners" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, id: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, id: "a".repeat(65) }).success).toBe(false);
  });

  it("refuses a new list that reuses an existing id, which the upsert would overwrite", () => {
    const schema = makeAllowlistSchema(t, () => ["scanners"]);
    expect(schema.safeParse(valid).success).toBe(false);
  });

  it("names the first value that is not an address on a network purpose", () => {
    const schema = makeAllowlistSchema(t);
    const res = schema.safeParse({ ...valid, values: "10.0.0.0/8\nscanner-01" });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toContain("scanner-01");
    expect(
      schema.safeParse({ ...valid, purpose: "service_account", values: "svc-backup" }).success,
    ).toBe(true);
  });

  it("round-trips a list into the form and back to a request body with explicit keys", () => {
    const list = {
      id: "egress",
      name: " Egress ",
      purpose: "known_egress" as const,
      values: ["203.0.113.0/24", "198.51.100.7"],
      description: " NAT ",
      updated_by: "a@b.c",
      updated_at: 1,
    };
    const form = allowlistDefaults(list);
    expect(form.values).toBe("203.0.113.0/24\n198.51.100.7");
    expect(allowlistPayload(form)).toEqual({
      name: "Egress",
      purpose: "known_egress",
      values: ["203.0.113.0/24", "198.51.100.7"],
      description: "NAT",
    });
  });
});
