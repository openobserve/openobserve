// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the AddFunction Zod schema — the restored Quasar BEFORE rules
// for the function `name` (required + method-name regex) and the optional
// `transType`.

import { describe, it, expect } from "vitest";
import { addFunctionSchema } from "./AddFunction.schema";

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

    it("trims the name", () => {
      const res = addFunctionSchema.safeParse({ name: "  myFn  " });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.name).toBe("myFn");
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
    expect(
      addFunctionSchema.safeParse({ name: "my_function", transType: "0" }).success,
    ).toBe(true);
  });
});
