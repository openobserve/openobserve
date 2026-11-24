// Copyright 2026 OpenObserve Inc.

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

  describe("name (required; normalized form and max 64 on create)", () => {
    it("requires a non-empty name", () => {
      const msgs = messagesFor({ ...base(), name: "" }, "name");
      expect(msgs).toContain("aiToolset.nameRequired");
    });

    it("rejects names that normalization would change", () => {
      for (const name of [
        "bad name",
        "has/slash",
        "dot.dot",
        "Upper",
        "under_score",
        "-lead",
        "trail-",
        "dou--ble",
      ]) {
        expect(messagesFor({ ...base(), name }, "name")).toContain("aiToolset.nameInvalid");
      }
    });

    it("accepts lowercase letters, digits and single inner hyphens", () => {
      expect(errorPaths({ ...base(), name: "datadog-prod-2" })).not.toContain("name");
    });

    it("rejects a name longer than 64 chars", () => {
      expect(messagesFor({ ...base(), name: "a".repeat(65) }, "name")).toContain(
        "aiToolset.nameTooLong",
      );
    });

    it("accepts a name of exactly 64 chars", () => {
      expect(errorPaths({ ...base(), name: "a".repeat(64) })).not.toContain("name");
    });

    it("does not re-check the immutable name of a saved toolset", () => {
      const editSchema = makeAddAiToolsetSchema(t, () => true);
      expect(editSchema.safeParse({ ...base(), name: "Legacy Name_1" }).success).toBe(true);
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
    });

    it("accepts populated header rows", () => {
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

  describe("OAuth client credentials", () => {
    const filled = {
      token_url: "https://sso.example.com/token",
      client_id: "svc",
      client_secret: "s3cret",
      scope: "",
    };
    const withAuth = (auth: Record<string, string>, headers: Record<string, string>[] = []) => ({
      ...base(),
      mcp: { ...base().mcp, auth, headers },
    });

    it("are optional: all empty, or only a preset's token URL, is headers only", () => {
      expect(errorPaths(withAuth({}))).toEqual([]);
      expect(errorPaths(withAuth({ token_url: filled.token_url }))).toEqual([]);
      const headers = [{ key: "Authorization", value: "Bearer t" }];
      expect(errorPaths(withAuth({ token_url: filled.token_url }, headers))).toEqual([]);
    });

    it("require a token URL and a client secret once a client ID is filled", () => {
      expect(errorPaths(withAuth(filled))).toEqual([]);
      expect(errorPaths(withAuth({ ...filled, client_secret: "***" }))).toEqual([]);
      const idOnly = withAuth({ client_id: "svc" });
      expect(messagesFor(idOnly, "mcp.auth.token_url")).toEqual(["aiToolset.tokenUrlRequired"]);
      expect(messagesFor(idOnly, "mcp.auth.client_secret")).toEqual([
        "aiToolset.clientSecretRequired",
      ]);
    });

    it("require a client ID once a client secret is filled", () => {
      expect(messagesFor(withAuth({ ...filled, client_id: " " }), "mcp.auth.client_id")).toEqual([
        "aiToolset.clientIdRequired",
      ]);
    });

    it.each(["http://sso.example.com/token", "sso.example.com/token", "not a url"])(
      "refuse the token URL %s",
      (token_url) => {
        expect(messagesFor(withAuth({ ...filled, token_url }), "mcp.auth.token_url")).toEqual([
          "aiToolset.tokenUrlHttps",
        ]);
      },
    );

    it.each(["Authorization", " authorization "])(
      "refuse a filled %s header but not an empty one",
      (key) => {
        const rows = (value: string) => [
          { key: "X-Tenant", value: "t" },
          { key, value },
        ];
        expect(messagesFor(withAuth(filled, rows("Bearer t")), "mcp.headers.1.key")).toEqual([
          "aiToolset.authorizationWithOauth",
        ]);
        expect(errorPaths(withAuth(filled, rows("***")))).toEqual(["mcp.headers.1.key"]);
        expect(errorPaths(withAuth(filled, rows("")))).toEqual([]);
      },
    );

    it("aren't checked for a skill", () => {
      const skill = { ...withAuth({ client_id: "svc" }), kind: "skill", skill: { content: "# x" } };
      expect(errorPaths(skill)).toEqual([]);
    });
  });

  describe("addAiToolsetDefaults", () => {
    it("produces a schema-shaped blank record", () => {
      expect(addAiToolsetDefaults()).toEqual({
        name: "",
        kind: "mcp",
        description: "",
        region_only: false,
        mcp: {
          url: "",
          timeout_seconds: 30,
          headers: [],
          auth: { token_url: "", client_id: "", client_secret: "", scope: "", extra: {} },
          allowed_tools: [],
          blocked_tools: null,
          write_tools: null,
          extra: {},
        },
        skill: { content: "" },
      });
    });
  });
});
