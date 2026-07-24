// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the AddAiToolset Zod schema — the always-on name/kind rules
// and the kind-conditional mcp.url / cli.command requireds (superRefine). This
// is the BEFORE validation baseline re-encoded as Zod
// ("4 blocks → 6 sub-rules").

import { describe, it, expect } from "vitest";
import { makeAddAiToolsetSchema, addAiToolsetDefaults } from "./AddAiToolset.schema";

// i18n passthrough — return the key so we can assert exact message keys survive.
const t = (key: string) => key;

const schema = makeAddAiToolsetSchema(t);

// A fully-valid MCP record (the default kind).
const base = () => ({
  ...addAiToolsetDefaults(),
  name: "my-toolset",
  kind: "mcp",
  mcp: { url: "https://api.example.com/mcp/", timeout_seconds: 30 },
});

// Return the set of error paths (joined) for a given input.
const errorPaths = (input: any): string[] => {
  const res = schema.safeParse(input);
  if (res.success) return [];
  return res.error.issues.map((i) => i.path.join("."));
};

// Return the messages for a given field path.
const messagesFor = (input: any, path: string): string[] => {
  const res = schema.safeParse(input);
  if (res.success) return [];
  return res.error.issues.filter((i) => i.path.join(".") === path).map((i) => i.message);
};

describe("AddAiToolset.schema", () => {
  it("accepts a fully valid mcp record", () => {
    expect(schema.safeParse(base()).success).toBe(true);
  });

  describe("name (always required + regex + max256)", () => {
    it("requires a non-empty name", () => {
      const msgs = messagesFor({ ...base(), name: "" }, "name");
      expect(msgs).toContain("aiToolset.nameRequired");
    });

    it("rejects names with invalid characters", () => {
      expect(messagesFor({ ...base(), name: "bad name" }, "name")).toContain(
        "aiToolset.nameInvalid",
      );
      expect(messagesFor({ ...base(), name: "has/slash" }, "name")).toContain(
        "aiToolset.nameInvalid",
      );
      expect(messagesFor({ ...base(), name: "dot.dot" }, "name")).toContain(
        "aiToolset.nameInvalid",
      );
    });

    it("accepts alphanumeric + hyphen + underscore", () => {
      expect(errorPaths({ ...base(), name: "valid_name-123" })).not.toContain("name");
    });

    it("rejects a name longer than 256 chars", () => {
      expect(messagesFor({ ...base(), name: "a".repeat(257) }, "name")).toContain(
        "aiToolset.nameTooLong",
      );
    });

    it("accepts a name of exactly 256 chars", () => {
      expect(errorPaths({ ...base(), name: "a".repeat(256) })).not.toContain("name");
    });
  });

  describe("kind (always required)", () => {
    it("requires a non-empty kind", () => {
      const msgs = messagesFor({ ...base(), kind: "" }, "kind");
      expect(msgs).toContain("aiToolset.kindRequired");
    });
  });

  describe("mcp.url (required only when kind === mcp)", () => {
    it("is required when kind is mcp", () => {
      const msgs = messagesFor(
        { ...base(), kind: "mcp", mcp: { url: "", timeout_seconds: 30 } },
        "mcp.url",
      );
      expect(msgs).toContain("aiToolset.mcpUrlRequired");
    });

    it("accepts a whitespace-only url (BEFORE baseline used a bare !url check)", () => {
      expect(
        errorPaths({
          ...base(),
          kind: "mcp",
          mcp: { url: "   ", timeout_seconds: 30 },
        }),
      ).not.toContain("mcp.url");
    });

    it("is NOT required when kind is cli", () => {
      expect(
        errorPaths({
          ...base(),
          kind: "cli",
          mcp: { url: "", timeout_seconds: 30 },
          cli: { ...addAiToolsetDefaults().cli, command: "kubectl" },
        }),
      ).not.toContain("mcp.url");
    });

    it("is NOT required when kind is skill", () => {
      expect(
        errorPaths({
          ...base(),
          kind: "skill",
          mcp: { url: "", timeout_seconds: 30 },
        }),
      ).not.toContain("mcp.url");
    });
  });

  describe("cli.command (required only when kind === cli)", () => {
    it("is required when kind is cli", () => {
      const msgs = messagesFor(
        {
          ...base(),
          kind: "cli",
          cli: { ...addAiToolsetDefaults().cli, command: "" },
        },
        "cli.command",
      );
      expect(msgs).toContain("aiToolset.cliCommandRequired");
    });

    it("accepts a whitespace-only command (BEFORE baseline used a bare !command check)", () => {
      expect(
        errorPaths({
          ...base(),
          kind: "cli",
          cli: { ...addAiToolsetDefaults().cli, command: "   " },
        }),
      ).not.toContain("cli.command");
    });

    it("is NOT required when kind is mcp", () => {
      expect(
        errorPaths({
          ...base(),
          kind: "mcp",
          cli: { ...addAiToolsetDefaults().cli, command: "" },
        }),
      ).not.toContain("cli.command");
    });
  });

  describe("skill.content (required only when kind === skill)", () => {
    it("is required when kind is skill", () => {
      const msgs = messagesFor(
        { ...base(), kind: "skill", skill: { content: "" } },
        "skill.content",
      );
      expect(msgs).toContain("aiToolset.skillContentRequired");
    });

    it("treats whitespace-only content as missing", () => {
      expect(
        messagesFor({ ...base(), kind: "skill", skill: { content: "   " } }, "skill.content"),
      ).toContain("aiToolset.skillContentRequired");
    });

    it("passes when content is provided", () => {
      expect(errorPaths({ ...base(), kind: "skill", skill: { content: "# Hi" } })).not.toContain(
        "skill.content",
      );
    });

    it("is NOT required when kind is mcp", () => {
      expect(errorPaths({ ...base(), kind: "mcp", skill: { content: "" } })).not.toContain(
        "skill.content",
      );
    });
  });

  describe("number coercion", () => {
    it("coerces string timeouts to numbers (number <input> emits strings)", () => {
      const res = schema.safeParse({
        ...base(),
        mcp: { url: "https://x.test/mcp", timeout_seconds: "45" },
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.mcp.timeout_seconds).toBe(45);
      }
    });
  });

  describe("form-owned array-fields (no validation rule)", () => {
    it("defaults the arrays to empty", () => {
      const d = addAiToolsetDefaults();
      expect(d.mcp.headers).toEqual([]);
      expect(d.cli.env).toEqual([]);
      expect(d.cli.credFiles).toEqual([]);
    });

    it("accepts populated header / env / cred rows", () => {
      const res = schema.safeParse({
        ...base(),
        mcp: {
          url: "https://x.test/mcp",
          timeout_seconds: 30,
          headers: [{ key: "Authorization", value: "Bearer x", visible: false }],
        },
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.mcp.headers).toEqual([
          { key: "Authorization", value: "Bearer x", visible: false },
        ]);
      }
    });

    it("accepts blank starter rows (all fields optional)", () => {
      expect(
        schema.safeParse({
          ...base(),
          mcp: { url: "https://x.test/mcp", timeout_seconds: 30, headers: [{}] },
        }).success,
      ).toBe(true);
    });
  });

  describe("addAiToolsetDefaults", () => {
    it("produces a schema-shaped blank record", () => {
      expect(addAiToolsetDefaults()).toEqual({
        name: "",
        kind: "mcp",
        description: "",
        mcp: { url: "", timeout_seconds: 30, headers: [] },
        cli: {
          command: "",
          allowed_subcommands_raw: "",
          timeout_seconds: 30,
          max_output_bytes: 100000,
          requires_confirmation: false,
          env: [],
          credFiles: [],
        },
        skill: { content: "" },
      });
    });
  });
});
