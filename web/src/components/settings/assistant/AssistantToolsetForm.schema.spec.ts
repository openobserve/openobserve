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

  it("starts a CLI toolset with approval on and requires an allow-list", () => {
    const values = toolsetFormDefaults();
    expect(values.cli.requires_confirmation).toBe(true);
    values.name = "kube";
    values.kind = "cli";
    values.cli.command = "kubectl";
    expect(issuesOf(values)).toEqual([
      "cli.allowed_subcommands_raw=assistant.toolsets.form.allowRequired",
    ]);
    values.cli.allowed_subcommands_raw = "get, logs";
    expect(issuesOf(values)).toEqual([]);
    expect(toolsetDataOf(values, true).allowed_subcommands).toEqual(["get", "logs"]);
  });

  it("rejects a name another toolset already reaches the agent under", () => {
    const values = {
      ...toolsetFormDefaults(),
      name: "My_Tool",
      mcp: { url: "u", timeout_seconds: 30, headers: [] },
    };
    expect(issuesOf(values, { ...NONE, isTaken: (agent) => agent === "my-tool" })).toEqual([
      'name=assistant.toolsets.form.nameClash:{"agent":"my-tool"}',
    ]);
    expect(
      issuesOf(values, { ...NONE, editing: true, isTaken: (agent) => agent === "my-tool" }),
    ).toEqual([]);
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

  it("counts a CLI command, allow-list or approval change as a new destination and keeps blocked commands", () => {
    const record = {
      id: "ts_2",
      name: "kube",
      kind: "cli",
      data: {
        command: "kubectl",
        allowed_subcommands: ["get"],
        blocked_subcommands: ["delete"],
        requires_confirmation: true,
        env: { KUBE_CONTEXT: "***" },
      },
    };
    const loaded = toolsetFormOf(record, true);
    expect(toolsetDataOf(loaded, true).blocked_subcommands).toEqual(["delete"]);
    for (const change of [
      (v: typeof loaded) => (v.cli.command = "kubectl2"),
      (v: typeof loaded) => (v.cli.allowed_subcommands_raw = "get, logs"),
      (v: typeof loaded) => (v.cli.requires_confirmation = false),
    ]) {
      const values = structuredClone(loaded);
      change(values);
      expect(reenterReason(values, loaded, true)).toBe("destination");
    }
    const timeout = structuredClone(loaded);
    timeout.cli.timeout_seconds = 90;
    expect(reenterReason(timeout, loaded, true)).toBeNull();
    expect(toolsetDataOf(toolsetFormDefaults(), true)).not.toHaveProperty("blocked_subcommands");
  });
});
