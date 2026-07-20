// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the AddEnrichmentTable Zod schema, focused on the conditional
// file/url rules that branch on `source` + `updateMode` + `isUpdating`. These
// assert the restored validation rules (name required, CSV file required, URL
// required + http(s):// prefix).

import { describe, it, expect } from "vitest";
import { makeAddEnrichmentTableSchema } from "./AddEnrichmentTable.schema";

const errorPaths = (schema: any, input: any): string[] => {
  const res = schema.safeParse(input);
  if (res.success) return [];
  return res.error.issues.map((i: any) => i.path.join("."));
};

describe("AddEnrichmentTable.schema", () => {
  // The factory now takes vue-i18n's `t` first; a key-echo stub suffices since
  // these tests assert error PATHS, not message text.
  const t = (k: string) => k;
  // Two flavours: add mode (isUpdating=false) and update mode (isUpdating=true).
  const createSchema = makeAddEnrichmentTableSchema(t, () => false);
  const updateSchema = makeAddEnrichmentTableSchema(t, () => true);

  describe("name (required + trim)", () => {
    it("requires a non-empty name", () => {
      expect(
        errorPaths(createSchema, { name: "", source: "url", url: "https://x.com" }),
      ).toContain("name");
      expect(
        errorPaths(createSchema, { name: "   ", source: "url", url: "https://x.com" }),
      ).toContain("name");
    });

    it("accepts a name", () => {
      expect(
        errorPaths(createSchema, { name: "my_table", source: "url", url: "https://x.com" }),
      ).not.toContain("name");
    });
  });

  describe("file (required when source === file)", () => {
    it("requires a file when source is file", () => {
      expect(
        errorPaths(createSchema, { name: "t", source: "file", file: "" }),
      ).toContain("file");
    });

    it("passes when a file is provided", () => {
      const file = new File(["a"], "a.csv", { type: "text/csv" });
      expect(
        errorPaths(createSchema, { name: "t", source: "file", file }),
      ).not.toContain("file");
    });

    it("does not require a file when source is url", () => {
      expect(
        errorPaths(createSchema, { name: "t", source: "url", url: "https://x.com" }),
      ).not.toContain("file");
    });
  });

  describe("url (required + http(s):// when source === url)", () => {
    it("requires a url for a new table", () => {
      expect(
        errorPaths(createSchema, { name: "t", source: "url", url: "" }),
      ).toContain("url");
    });

    it("requires an http(s):// prefix", () => {
      expect(
        errorPaths(createSchema, { name: "t", source: "url", url: "ftp://x.com" }),
      ).toContain("url");
      expect(
        errorPaths(createSchema, { name: "t", source: "url", url: "example.com/data.csv" }),
      ).toContain("url");
    });

    it("accepts a valid http/https url", () => {
      expect(
        errorPaths(createSchema, { name: "t", source: "url", url: "https://x.com/data.csv" }),
      ).not.toContain("url");
      expect(
        errorPaths(createSchema, { name: "t", source: "url", url: "http://x.com/data.csv" }),
      ).not.toContain("url");
    });

    it("does NOT require a url for a reload-only update", () => {
      expect(
        errorPaths(updateSchema, {
          name: "t",
          source: "url",
          url: "",
          updateMode: "reload",
        }),
      ).not.toContain("url");
    });

    it("requires a url for append / replace updates", () => {
      expect(
        errorPaths(updateSchema, {
          name: "t",
          source: "url",
          url: "",
          updateMode: "append",
        }),
      ).toContain("url");
      expect(
        errorPaths(updateSchema, {
          name: "t",
          source: "url",
          url: "",
          updateMode: "replace",
        }),
      ).toContain("url");
    });
  });

  it("accepts a fully valid file record", () => {
    const file = new File(["a"], "a.csv", { type: "text/csv" });
    expect(
      createSchema.safeParse({ name: "t", source: "file", file, append: false })
        .success,
    ).toBe(true);
  });

  it("accepts a fully valid url record", () => {
    expect(
      createSchema.safeParse({
        name: "t",
        source: "url",
        url: "https://example.com/data.csv",
      }).success,
    ).toBe(true);
  });
});
