// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";

import {
  SECRET_MASK,
  keptSecretPaths,
  makeToolsetFormSchema,
  reenterReason,
  refusedSecretPaths,
  toolsetDataOf,
  toolsetFormDefaults,
  toolsetFormOf,
} from "./AssistantToolsetForm.schema";

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

const STORED = {
  id: "ts_1",
  name: "pagerduty",
  kind: "mcp",
  description: "Pages people",
  data: { url: "https://pd.example/mcp", timeout_seconds: 20, headers: { Authorization: "***" } },
};

type Options = Parameters<typeof makeToolsetFormSchema>[1];

const NONE: Options = { isTaken: () => false, editing: false, mergeSecrets: true };

const issuesOf = (values: unknown, options: Options = NONE) => {
  const result = makeToolsetFormSchema(t, options).safeParse(values);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}=${i.message}`);
};

describe("toolset form schema and payload", () => {
  it("words a zero timeout in the form's own message, not zod's", () => {
    const values = toolsetFormDefaults();
    values.name = "pager";
    values.mcp.url = "https://pd.example/mcp";
    values.mcp.timeout_seconds = 0;
    expect(issuesOf(values)).toEqual(["mcp.timeout_seconds=assistant.toolsets.form.wholeNumber"]);
  });

  it("never loads a stored secret into the form", () => {
    const merged = toolsetFormOf(STORED, true);
    expect(merged.mcp.headers).toEqual([
      { key: "Authorization", value: null, state: "unchanged", stored: "Authorization" },
    ]);
    const plain = toolsetFormOf(STORED, false);
    expect(plain.mcp.headers).toEqual([
      { key: "Authorization", value: "", state: "new", stored: "Authorization" },
    ]);
  });

  it("sends the mask for an unchanged secret only to a merging server", () => {
    const values = toolsetFormOf(STORED, true);
    expect(toolsetDataOf(values, true).headers).toEqual({ Authorization: SECRET_MASK });
    expect(toolsetDataOf(values, false).headers).toEqual({});
  });

  it("sends a replaced secret as typed and never forwards a typed mask", () => {
    const values = toolsetFormOf(STORED, true);
    values.mcp.headers = [
      { key: "Authorization", value: "Bearer new", state: "replacing" },
      { key: "X-Mask", value: SECRET_MASK, state: "new" },
    ];
    expect(toolsetDataOf(values, true).headers).toEqual({ Authorization: "Bearer new" });
  });

  it("asks for every secret again when the server cannot keep it", () => {
    const values = toolsetFormOf(STORED, false);
    expect(issuesOf(values, { ...NONE, mergeSecrets: false })).toEqual([
      "mcp.headers.0.value=assistant.toolsets.form.enterAgain",
    ]);
    values.mcp.headers[0].value = "Bearer typed";
    expect(issuesOf(values, { ...NONE, mergeSecrets: false })).toEqual([]);
  });

  it("loads and saves skill content", () => {
    const values = toolsetFormOf(
      { name: "triage", kind: "skill", data: { content: "## When to use" } },
      true,
    );
    expect(values.kind).toBe("skill");
    expect(issuesOf(values)).toEqual([]);
    expect(toolsetDataOf(values, true)).toEqual({ content: "## When to use" });
  });

  it("rejects a name another toolset already reaches the agent under", () => {
    const defaults = toolsetFormDefaults();
    const values = { ...defaults, name: "my-tool", mcp: { ...defaults.mcp, url: "u" } };
    expect(issuesOf(values, { ...NONE, isTaken: (agent) => agent === "my-tool" })).toEqual([
      'name=assistant.toolsets.form.nameClash:{"agent":"my-tool"}',
    ]);
    expect(
      issuesOf(values, { ...NONE, editing: true, isTaken: (agent) => agent === "my-tool" }),
    ).toEqual([]);
    // A new name must already be the one the agent sees, as the server requires.
    expect(issuesOf({ ...values, name: "My_Tool" })).toEqual(["name=aiToolset.nameInvalid"]);
  });

  it("rejects *** typed as a secret value", () => {
    const values = toolsetFormOf(STORED, true);
    values.mcp.headers[0] = { key: "Authorization", value: SECRET_MASK, state: "replacing" };
    expect(issuesOf(values)).toEqual(["mcp.headers.0.value=assistant.toolsets.form.maskValue"]);
  });

  it("sends a kept secret under its stored key even if the key field changed", () => {
    const values = toolsetFormOf(STORED, true);
    values.mcp.headers[0].key = "Authorisation";
    expect(toolsetDataOf(values, true).headers).toEqual({ Authorization: SECRET_MASK });
  });

  it("says when a merging server would refuse to keep the stored secrets", () => {
    const loaded = toolsetFormOf(
      { ...STORED, data: { ...STORED.data, headers: { Authorization: "***", "X-Team": "***" } } },
      true,
    );
    const values = structuredClone(loaded);
    expect(reenterReason(values, loaded, true)).toBeNull();
    values.mcp.url = "https://other.example/mcp";
    expect(reenterReason(values, loaded, true)).toBe("destination");
    expect(reenterReason(values, loaded, false)).toBeNull();
    const replaced = structuredClone(loaded);
    replaced.mcp.headers[1] = { key: "X-Team", value: "t7", state: "replacing", stored: "X-Team" };
    expect(reenterReason(replaced, loaded, true)).toBe("secret");
    expect(keptSecretPaths(replaced)).toEqual(["mcp.headers[0]"]);
    const removed = structuredClone(loaded);
    removed.mcp.headers.pop();
    expect(reenterReason(removed, loaded, true)).toBeNull();
  });

  describe("OAuth, presets and tool lists", () => {
    const OAUTH = {
      ...STORED,
      region_only: true,
      data: {
        url: "https://dt.example/mcp",
        timeout_seconds: 30,
        headers: { "X-Tenant": "***" },
        auth: {
          type: "oauth_client_credentials",
          token_url: "https://sso.example/token",
          client_id: "id-1",
          client_secret: "***",
          scope: "a b",
          extra_params: { resource: "***" },
        },
        allowed_tools: ["search_*"],
        write_tools: [],
        tool_classes: [{ tool: "search_logs", class: "logs" }],
        preset: { id: "dynatrace", revision: 2, params: { env: "https://dt.example" } },
        tools_verified_at: 5,
      },
    };

    it("keeps the stored client secret, lists and keys it doesn't edit, without URL copies", () => {
      const values = toolsetFormOf(OAUTH, true);
      expect(values.region_only).toBe(true);
      expect(values.mcp.auth.secret).toEqual({
        key: "client_secret",
        value: null,
        state: "unchanged",
        stored: "client_secret",
      });
      expect(toolsetDataOf(values, true)).toEqual({
        schema: 2,
        url: "https://dt.example/mcp",
        headers: { "X-Tenant": SECRET_MASK },
        timeout_seconds: 30,
        auth: {
          type: "oauth_client_credentials",
          token_url: "https://sso.example/token",
          client_id: "id-1",
          client_secret: SECRET_MASK,
          scope: "a b",
          extra_params: { resource: "***" },
        },
        allowed_tools: ["search_*"],
        write_tools: [],
        tool_classes: [{ tool: "search_logs", class: "logs" }],
        preset: { id: "dynatrace", revision: 2 },
      });
    });

    it("asks for the client secret again when the token URL moves", () => {
      const loaded = toolsetFormOf(OAUTH, true);
      const values = structuredClone(loaded);
      values.mcp.auth.token_url = "https://other.example/token";
      expect(reenterReason(values, loaded, true)).toBe("destination");
      expect(keptSecretPaths(values)).toEqual(["mcp.headers[0]", "mcp.auth.secret"]);
    });

    it("needs a client secret and an https token URL, and no typed Authorization header", () => {
      const values = toolsetFormDefaults();
      values.name = "dt";
      values.mcp.url = "https://dt.example/mcp";
      values.mcp.auth.client_id = "id-1";
      values.mcp.auth.token_url = "http://sso.example/token";
      values.mcp.headers = [{ key: "Authorization", value: "Bearer x", state: "new" }];
      expect(issuesOf(values)).toEqual([
        "mcp.auth.token_url=aiToolset.tokenUrlHttps",
        "mcp.auth.secret.value=aiToolset.clientSecretRequired",
        "mcp.headers.0.key=aiToolset.authorizationWithOauth",
      ]);
      const replicated = { ...NONE, missingSecretOk: () => true };
      values.mcp.auth.token_url = "https://sso.example/token";
      values.mcp.headers = [];
      expect(issuesOf(values, replicated)).toEqual([]);
    });

    it("starts a new MCP with every tool off and refuses an empty preset field", () => {
      const values = toolsetFormDefaults();
      values.name = "dd";
      values.mcp.url = "https://dd.example/mcp";
      expect(toolsetDataOf(values, true).allowed_tools).toEqual([]);
      values.mcp.preset_params = { site: " " };
      expect(issuesOf(values)).toEqual(["mcp.preset_params.site=aiToolset.presetParamRequired"]);
    });
  });

  it("loads AutoResolve's write headers by name only and keeps each unless it is replaced", () => {
    const record = {
      ...STORED,
      data: { ...STORED.data, write_header_names: ["X-Write", "X-Org"] },
    };
    // Even a server that cannot keep the plain headers keeps a write header sent as the mask.
    const values = toolsetFormOf(record, false);
    expect(values.mcp.writeHeaders).toEqual([
      { key: "X-Write", value: null, state: "unchanged", stored: "X-Write" },
      { key: "X-Org", value: null, state: "unchanged", stored: "X-Org" },
    ]);
    values.mcp.headers = [];
    values.mcp.writeHeaders[1] = {
      key: "X-Org",
      value: "o-2",
      state: "replacing",
      stored: "X-Org",
    };
    values.mcp.writeHeaders.push({ key: "X-New", value: "n-1", state: "new" });
    expect(toolsetDataOf(values, false, true).write_headers).toEqual({
      "X-Write": SECRET_MASK,
      "X-Org": "o-2",
      "X-New": "n-1",
    });
    // Without AutoResolve the body leaves them out, so the server keeps the stored ones.
    expect(toolsetDataOf(values, false, false)).not.toHaveProperty("write_headers");
  });

  it("asks for a new write header's value and refuses a typed mask", () => {
    const values = toolsetFormDefaults();
    values.name = "pager";
    values.mcp.url = "https://pd.example/mcp";
    values.mcp.writeHeaders = [
      { key: "X-Write", value: "", state: "new" },
      { key: "X-Org", value: SECRET_MASK, state: "new" },
    ];
    expect(issuesOf(values)).toEqual([
      "mcp.writeHeaders.0.value=assistant.toolsets.form.enterAgain",
      "mcp.writeHeaders.1.value=assistant.toolsets.form.maskValue",
    ]);
  });

  it("asks for kept write headers again when the URL changes, and only when they are sent", () => {
    const record = {
      ...STORED,
      data: { ...STORED.data, headers: {}, write_header_names: ["X-Write"] },
    };
    const loaded = toolsetFormOf(record, true);
    const values = structuredClone(loaded);
    values.mcp.url = "https://other.example/mcp";
    expect(reenterReason(values, loaded, true, true)).toBe("destination");
    expect(keptSecretPaths(values, true)).toEqual(["mcp.writeHeaders[0]"]);
    // Without AutoResolve the body leaves them out, and the server drops them for a new URL.
    expect(reenterReason(values, loaded, true, false)).toBeNull();
    expect(keptSecretPaths(values)).toEqual([]);
  });

  it("asks again only for the list whose kept secret would travel next to a new one", () => {
    const record = {
      ...STORED,
      data: { ...STORED.data, headers: { Authorization: "***" }, write_header_names: ["X-Write"] },
    };
    const loaded = toolsetFormOf(record, true);
    const values = structuredClone(loaded);
    values.mcp.writeHeaders.push({ key: "X-New", value: "n-1", state: "new" });
    expect(reenterReason(values, loaded, true, true)).toBe("secret");
    expect(refusedSecretPaths(values, loaded, true, true)).toEqual(["mcp.writeHeaders[0]"]);
    // A changed URL refuses every kept secret in both lists.
    values.mcp.url = "https://other.example/mcp";
    expect(refusedSecretPaths(values, loaded, true, true)).toEqual([
      "mcp.headers[0]",
      "mcp.writeHeaders[0]",
    ]);
  });
});
