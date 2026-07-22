// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the EditScript Zod schema — the object-level rules
// (name/type/service_account; timezone defaulted-not-enforced) and the
// superRefine conditionals (codeZip required-on-create; cron validated byte-exact
// to main's two paths — execution_details === "repeat" on EDIT, and only-once-the-
// cron-field-is-edited on CREATE, preserving the never-touched-blank gap).

import { describe, it, expect, vi } from "vitest";
import { makeEditScriptSchema } from "./EditScript.schema";

// Mirror the production isValidResourceName behaviour (reject :, /, ?, #, space).
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: (val: string) => !/[:/?#\s]/.test(val),
}));

// i18n passthrough. The schema translates every message (common.nameRequired,
// actions.nameInvalidChars, actions.fieldRequired, actions.zipFileRequired); the
// tests assert on error PATHS, not copy, so returning the key is sufficient.
const t = (key: string) =>
  key === "common.nameRequired" ? "Name is required" : key;

// `getCronError` is injected by the component; here a tiny stub treats the
// literal "bad" as an invalid cron and everything else as valid. `execution_details`
// (main's EDIT gate) and `cronEdited` (main's CREATE "field was touched" gate) are
// also injected — both default to the cron-validating state so the general valid-
// record tests still exercise the cron happy path.
const makeSchema = (
  isEditing = false,
  executionDetails = "repeat",
  cronEdited = true,
) =>
  makeEditScriptSchema({
    t,
    getIsEditing: () => isEditing,
    getCronError: (cron: string) =>
      cron === "bad" ? "Invalid cron expression!" : "",
    getExecutionDetails: () => executionDetails,
    getCronEdited: () => cronEdited,
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

const errorPaths = (
  input: any,
  isEditing = false,
  executionDetails = "repeat",
  cronEdited = true,
): string[] => {
  const res = makeSchema(isEditing, executionDetails, cronEdited).safeParse(
    input,
  );
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

    it("does NOT enforce timezone (parity with pre-migration main)", () => {
      expect(errorPaths({ ...base(), timezone: "" })).not.toContain("timezone");
    });

    it("defaults timezone to UTC when omitted", () => {
      const { timezone: _timezone, ...rest } = base();
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

  describe("cron (byte-exact main: execution_details on edit + edited-field on create)", () => {
    // ── EDIT path — main validated via execution_details === "repeat", regardless
    // of whether the (disabled) field was touched. cronEdited=false proves the
    // edit gate stands on its own.
    it("is required when execution_details is repeat and cron empty", () => {
      expect(
        errorPaths({ ...base(), cron: "" }, false, "repeat", false),
      ).toContain("cron");
    });

    it("flags an invalid cron when execution_details is repeat", () => {
      expect(
        errorPaths({ ...base(), cron: "bad" }, false, "repeat", false),
      ).toContain("cron");
    });

    it("accepts a valid cron when execution_details is repeat", () => {
      expect(
        errorPaths({ ...base(), cron: "0 12 * * *" }, false, "repeat", false),
      ).not.toContain("cron");
    });

    // ── CREATE path — execution_details is "" the whole time; cron is validated
    // ONLY once the user has edited the field (main's inline @update handler).
    it("validates a blank cron on create once the field is edited", () => {
      expect(errorPaths({ ...base(), cron: "" }, false, "", true)).toContain(
        "cron",
      );
    });

    it("flags an invalid cron on create once the field is edited", () => {
      expect(errorPaths({ ...base(), cron: "bad" }, false, "", true)).toContain(
        "cron",
      );
    });

    // ── The preserved latent gap: repeat selected but cron field NEVER touched →
    // a blank cron still saves on create (matches main exactly).
    it("does NOT validate an untouched blank cron on create (main's gap, preserved)", () => {
      expect(errorPaths({ ...base(), cron: "" }, false, "", false)).not.toContain(
        "cron",
      );
    });

    // A 'once' schedule never validates cron even if the field was edited (the
    // create gate also requires the live repeat tab).
    it("is NOT validated for a 'once' schedule even if the field was edited", () => {
      expect(
        errorPaths(
          { ...base(), frequencyType: "once", cron: "" },
          false,
          "",
          true,
        ),
      ).not.toContain("cron");
    });
  });
});
