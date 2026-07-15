// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the CreateDestinationForm Zod schema, focused on the
// object-level rules (name/url) and the superRefine conditionals that branch on
// destination_type / output_format.

import { describe, it, expect, vi } from "vitest";
import { makeDestinationSchema } from "./CreateDestinationForm.schema";

// Mirror the production isValidResourceName behaviour (reject :, /, ?, #, space).
vi.mock("@/utils/zincutils", () => ({
  isValidResourceName: (val: string) => !/[:/?#\s]/.test(val),
}));

// i18n passthrough (the only key the schema uses is common.nameRequired).
const t = (key: string) =>
  key === "common.nameRequired" ? "Name is required" : key;

const schema = makeDestinationSchema(t);

// A fully-valid base record for the default destination_type (openobserve).
const base = () => ({
  name: "my-dest",
  url: "https://example.com",
  destination_type: "openobserve",
  url_endpoint: "/api/default/default/_json",
  method: "post",
  output_format: "json",
  esbulk_index: "",
  separator: "",
  org: "default",
  stream: "default",
});

// Return the set of error paths (joined) for a given input.
const errorPaths = (input: any): string[] => {
  const res = schema.safeParse(input);
  if (res.success) return [];
  return res.error.issues.map((i) => i.path.join("."));
};

describe("CreateDestinationForm.schema", () => {
  it("accepts a fully valid openobserve record", () => {
    expect(schema.safeParse(base()).success).toBe(true);
  });

  describe("name (object-level)", () => {
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

  describe("url (object-level)", () => {
    it("requires a non-empty url", () => {
      expect(errorPaths({ ...base(), url: "" })).toContain("url");
      expect(errorPaths({ ...base(), url: "   " })).toContain("url");
    });

    it("rejects a trailing slash", () => {
      expect(errorPaths({ ...base(), url: "https://example.com/" })).toContain(
        "url",
      );
    });

    it("accepts a url with no trailing slash", () => {
      expect(errorPaths({ ...base(), url: "https://example.com" })).not.toContain(
        "url",
      );
    });
  });

  describe("openobserve → org + stream", () => {
    it("requires org and stream", () => {
      const paths = errorPaths({
        ...base(),
        destination_type: "openobserve",
        org: "",
        stream: "",
      });
      expect(paths).toContain("org");
      expect(paths).toContain("stream");
    });

    it("does NOT require org/stream for other types", () => {
      const paths = errorPaths({
        ...base(),
        destination_type: "custom",
        url_endpoint: "",
        org: "",
        stream: "",
      });
      expect(paths).not.toContain("org");
      expect(paths).not.toContain("stream");
    });
  });

  describe("url_endpoint", () => {
    it("is required for non-custom types", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "splunk",
          url_endpoint: "",
        }),
      ).toContain("url_endpoint");
    });

    it("is NOT required for custom type", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "",
        }),
      ).not.toContain("url_endpoint");
    });

    it("must start with / when present (any type)", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "no-slash",
        }),
      ).toContain("url_endpoint");
    });

    it("accepts a path starting with /", () => {
      expect(
        errorPaths({ ...base(), url_endpoint: "/services/collector" }),
      ).not.toContain("url_endpoint");
    });
  });

  describe("method + output_format (always required)", () => {
    it("requires method", () => {
      expect(errorPaths({ ...base(), method: "" })).toContain("method");
    });

    it("requires output_format", () => {
      expect(errorPaths({ ...base(), output_format: "" })).toContain(
        "output_format",
      );
    });
  });

  describe("esbulk_index (output_format === esbulk)", () => {
    it("is required when format is esbulk", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "",
          output_format: "esbulk",
          esbulk_index: "",
        }),
      ).toContain("esbulk_index");
    });

    it("passes when esbulk_index is provided", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "",
          output_format: "esbulk",
          esbulk_index: "logs",
        }),
      ).not.toContain("esbulk_index");
    });

    it("is not required for non-esbulk formats", () => {
      expect(
        errorPaths({ ...base(), output_format: "json", esbulk_index: "" }),
      ).not.toContain("esbulk_index");
    });
  });

  describe("separator (output_format === stringseparated)", () => {
    it("is required when format is stringseparated", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "",
          output_format: "stringseparated",
          separator: "",
        }),
      ).toContain("separator");
    });

    it("allows a single space as a valid separator", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "",
          output_format: "stringseparated",
          separator: " ",
        }),
      ).not.toContain("separator");
    });

    it("accepts a normal separator", () => {
      expect(
        errorPaths({
          ...base(),
          destination_type: "custom",
          url_endpoint: "",
          output_format: "stringseparated",
          separator: "|",
        }),
      ).not.toContain("separator");
    });
  });

  describe("datadog → ddsource + ddtags", () => {
    it("requires ddsource and ddtags", () => {
      const paths = errorPaths({
        ...base(),
        destination_type: "datadog",
        url_endpoint: "/v1/input",
        metadata: { ddsource: "", ddtags: "" },
      });
      expect(paths).toContain("metadata.ddsource");
      expect(paths).toContain("metadata.ddtags");
    });

    it("passes when ddsource + ddtags are provided", () => {
      const paths = errorPaths({
        ...base(),
        destination_type: "datadog",
        url_endpoint: "/v1/input",
        metadata: { ddsource: "nginx", ddtags: "env:prod" },
      });
      expect(paths).not.toContain("metadata.ddsource");
      expect(paths).not.toContain("metadata.ddtags");
    });

    it("does NOT require dd fields for other types", () => {
      const paths = errorPaths({
        ...base(),
        destination_type: "splunk",
        url_endpoint: "/services/collector",
        metadata: { ddsource: "", ddtags: "" },
      });
      expect(paths).not.toContain("metadata.ddsource");
      expect(paths).not.toContain("metadata.ddtags");
    });
  });
});
