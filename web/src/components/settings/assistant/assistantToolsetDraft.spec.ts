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

import { toolsetFormDefaults } from "./AssistantToolsetForm.schema";
import {
  draftFieldName,
  draftRedactedLabels,
  redactToolsetDraft,
  toolsetDraftOf,
  toolsetFormOfDraft,
} from "./assistantToolsetDraft";

describe("assistantToolsetDraft", () => {
  it("blanks every secret and a URL carrying a token, and leaves a kept secret as it is", () => {
    const values = toolsetFormDefaults();
    values.mcp.url = "https://mcp.example/?token=abc";
    values.mcp.preset_params = { site: "x" };
    values.mcp.headers = [
      { key: "Authorization", value: null, state: "unchanged", stored: "Authorization" },
      { key: "X-Team", value: "team-7", state: "new" },
    ];
    values.mcp.auth.secret.value = "s3cr3t";
    const { data, paths } = redactToolsetDraft(toolsetDraftOf(values));
    expect(JSON.stringify(data)).not.toMatch(/abc|team-7|s3cr3t|preset_params/);
    expect(data.mcp.headers[0]).toMatchObject({ value: null, state: "unchanged" });
    expect(paths).toEqual(["/mcp/url", "/mcp/auth/secret/value", "/mcp/headers/1/value"]);
    expect(draftRedactedLabels(paths, data)).toEqual([
      { kind: "url" },
      { kind: "client_secret" },
      { kind: "header", name: "X-Team" },
    ]);
    expect(paths.map(draftFieldName)).toEqual([
      "mcp.url",
      "mcp.auth.secret.value",
      "mcp.headers[1].value",
    ]);
  });

  it("reads a draft the older toolset form wrote, field by field", () => {
    const older = {
      name: "ops",
      kind: "mcp",
      mcp: {
        url: "https://mcp.example/",
        headers: [{ key: "X-Team", value: "" }],
        auth: { token_url: "https://sso.example/token", client_id: "c1", client_secret: "" },
      },
    };
    const values = toolsetFormOfDraft(older);
    expect(values.mcp.headers).toEqual([{ key: "X-Team", value: "", state: "new" }]);
    expect(values.mcp.auth).toMatchObject({
      token_url: "https://sso.example/token",
      client_id: "c1",
      secret: { key: "client_secret", value: "", state: "new" },
    });
    expect(values.mcp.preset_params).toEqual({});
    expect(values.skill).toEqual({ content: "" });
  });
});
