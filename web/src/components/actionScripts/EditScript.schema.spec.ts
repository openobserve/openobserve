// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the EditScript Zod schema — the object-level rules
// (name/type/service_account/timezone) and the superRefine conditionals
// (codeZip required-on-create, cron required+valid when scheduled+repeat).
// These restore the Quasar BEFORE baseline (6 rules) with the truthy→Zod
// inversion (required + custom check, not check-only).

import { describe, it, expect, vi } from "vitest";
import { makeEditScriptSchema } from "./EditScript.schema";

// Mirror the production isValidResourceName behaviour (reject :, /, ?, #, space).
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: (val: string) => !/[:\/?#\s]/.test(val),
}));

// i18n passthrough (the only key the schema uses is common.nameRequired).
const t = (key: string) =>
  key === "common.nameRequired" ? "Name is required" : key;

// `getCronError` is injected by the component; here a tiny stub treats the
// literal "bad" as an invalid cron and everything else as valid.
const makeSchema = (isEditing = false) =>
  makeEditScriptSchema({
    t,
    getIsEditing: () => isEditing,
    getCronError: (cron: string) =>
      cron === "bad" ? "Invalid cron expression!" : "",
  });

// A fully-valid CREATE record (scheduled + repeat, with a file + valid cron).
const base = () => ({
  name: "my_action",
  description: "",
  type: "scheduled",
  service_account: "svc@example.com",
  timezone: "UTC",
  codeZip: new File(["x"], "script.zip"),
  cron: "0 0 * * *",
  frequencyType: "repeat",
});

const errorPaths = (input: any, isEditing = false): string[] => {
  const res = makeSchema(isEditing).safeParse(input);
  if (res.success) return [];
  return res.error.issues.map((i) => i.path.join("."));
};

describe("EditScript.schema", () => {
  it("accepts a fully valid create record", () => {
    expect(makeSchema().safeParse(base()).success).toBe(true);
  });

  describe("name", () => {
    it("requires a non-empty name", () => {
      expect(errorPaths({ ...base(), name: "" })).toContain("name");
    });

    it("rejects invalid resource characters", () => {
      expect(errorPaths({ ...base(), name: "bad name?" })).toContain("name");
      expect(errorPaths({ ...base(), name: "a/b" })).toContain("name");
    });

    it("accepts a clean resource name", () => {
      expect(errorPaths({ ...base(), name: "valid_name-1" })).not.toContain(
        "name",
      );
    });
  });

  describe("required scalars", () => {
    it("requires type", () => {
      expect(errorPaths({ ...base(), type: "" })).toContain("type");
    });

    it("requires service_account", () => {
      expect(errorPaths({ ...base(), service_account: "" })).toContain(
        "service_account",
      );
    });

    it("requires timezone", () => {
      expect(errorPaths({ ...base(), timezone: "" })).toContain("timezone");
    });

    it("defaults timezone to UTC when omitted", () => {
      const { timezone, ...rest } = base();
      const res = makeSchema().safeParse(rest);
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.timezone).toBe("UTC");
    });
  });

  describe("codeZip (required only on create)", () => {
    it("is required on create", () => {
      expect(errorPaths({ ...base(), codeZip: null }, false)).toContain(
        "codeZip",
      );
    });

    it("is NOT required on edit", () => {
      expect(errorPaths({ ...base(), codeZip: null }, true)).not.toContain(
        "codeZip",
      );
    });
  });

  describe("cron (required + valid only when scheduled + repeat)", () => {
    it("is required when scheduled + repeat and empty", () => {
      expect(
        errorPaths({
          ...base(),
          type: "scheduled",
          frequencyType: "repeat",
          cron: "",
        }),
      ).toContain("cron");
    });

    it("flags an invalid cron when scheduled + repeat", () => {
      expect(
        errorPaths({
          ...base(),
          type: "scheduled",
          frequencyType: "repeat",
          cron: "bad",
        }),
      ).toContain("cron");
    });

    it("accepts a valid cron when scheduled + repeat", () => {
      expect(
        errorPaths({
          ...base(),
          type: "scheduled",
          frequencyType: "repeat",
          cron: "0 12 * * *",
        }),
      ).not.toContain("cron");
    });

    it("is NOT required for a 'once' schedule", () => {
      expect(
        errorPaths({
          ...base(),
          type: "scheduled",
          frequencyType: "once",
          cron: "",
        }),
      ).not.toContain("cron");
    });

    it("is NOT required for a non-scheduled (service) action", () => {
      expect(
        errorPaths({
          ...base(),
          type: "service",
          frequencyType: "repeat",
          cron: "",
        }),
      ).not.toContain("cron");
    });
  });
});
