// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the AddFunction Zod schema — the previous validation rules
// for the function `name` (required + method-name regex) and the optional
// `transType`.

import { describe, it, expect } from "vitest";
import { makeAddFunctionSchema } from "./AddFunction.schema";

// The schema is now a factory taking vue-i18n's `t`. These tests assert only
// VALIDITY (success / error paths), not the message text, so a stub that echoes
// the key is sufficient.
const addFunctionSchema = makeAddFunctionSchema((k: string) => k);

const errorPaths = (input: any): string[] => {
  const res = addFunctionSchema.safeParse(input);
  if (res.success) return [];
  return res.error.issues.map((i: any) => i.path.join("."));
};

describe("AddFunction.schema", () => {
  describe("name (required + method-name regex)", () => {
    it("requires a name", () => {
      expect(errorPaths({ name: "" })).toContain("name");
      expect(errorPaths({ name: "   " })).toContain("name");
    });

    it("rejects invalid method names", () => {
      expect(errorPaths({ name: "123abc" })).toContain("name");
      expect(errorPaths({ name: "has-dash" })).toContain("name");
      expect(errorPaths({ name: "has space" })).toContain("name");
      expect(errorPaths({ name: "name!" })).toContain("name");
    });

    it("accepts valid method names", () => {
      for (const n of ["validName", "valid_name", "_underscore", "A1_b2", "UPPER"]) {
        expect(errorPaths({ name: n })).not.toContain("name");
      }
    });

    it("rejects a name with leading/trailing whitespace (validated raw, no schema .trim())", () => {
      // Regression guard: OForm/TanStack validates with the schema but SAVES the
      // raw form value, so a schema .trim() would let a padded name PASS yet
      // persist the space. The name must be validated raw and rejected.
      expect(addFunctionSchema.safeParse({ name: "  myFn  " }).success).toBe(false);
      expect(addFunctionSchema.safeParse({ name: "myfunc " }).success).toBe(false);
      expect(addFunctionSchema.safeParse({ name: " myfunc" }).success).toBe(false);
      // A clean name still passes.
      expect(addFunctionSchema.safeParse({ name: "myfunc" }).success).toBe(true);
    });
  });

  describe("transType (optional, default 0)", () => {
    it("defaults to '0' when omitted", () => {
      const res = addFunctionSchema.safeParse({ name: "myFn" });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.transType).toBe("0");
    });

    it("accepts '1' (JavaScript)", () => {
      expect(errorPaths({ name: "myFn", transType: "1" })).not.toContain("transType");
    });
  });

  it("accepts a fully valid record", () => {
    expect(addFunctionSchema.safeParse({ name: "my_function", transType: "0" }).success).toBe(true);
  });
});
