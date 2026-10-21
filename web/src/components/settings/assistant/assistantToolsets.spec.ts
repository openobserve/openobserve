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
  agentNameOf,
  clashingNames,
  hasToolsetHealth,
  healthOf,
  matchesToolset,
  parseToolsetRows,
  runsWithoutApproval,
} from "./assistantToolsets";

const RAW = [
  { id: "1", name: "My_Tool", kind: "mcp", description: "Pages people", data: { url: "x" } },
  { id: "2", name: "my-tool", kind: "skill" },
  {
    id: "3",
    name: "kube",
    kind: "cli",
    data: { command: "kubectl", requires_confirmation: false, allowed_subcommands: [] },
  },
];

describe("assistantToolsets", () => {
  it("folds names exactly as the server does", () => {
    const vectors: [string, string][] = [
      [" My_Tool ", "my-tool"],
      ["a b_c", "a-b-c"],
      ["my-_tool", "my-tool"],
      ["-tool", "tool"],
      ["Café.API", "caf-api"],
      ["___", "toolset"],
      ["", "toolset"],
      ["x".repeat(70), "x".repeat(64)],
    ];
    for (const [name, agent] of vectors) expect(agentNameOf(name)).toBe(agent);
  });

  it("drops rows with unknown kinds, oversize text or no id", () => {
    const rows = parseToolsetRows([
      ...RAW,
      { id: "4", name: "x", kind: "rogue" },
      { name: "no-id", kind: "mcp" },
      { id: "5", name: "y".repeat(600), kind: "mcp" },
      "junk",
    ]);
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3"]);
    expect(parseToolsetRows({ toolsets: [] })).toEqual([]);
  });

  it("detects the health fields only when a record carries them", () => {
    expect(hasToolsetHealth(parseToolsetRows(RAW))).toBe(false);
    const rows = parseToolsetRows([{ ...RAW[0], enabled: false, status: { state: "disabled" } }]);
    expect(hasToolsetHealth(rows)).toBe(true);
    expect(healthOf(rows[0])).toBe("disabled");
    expect(healthOf(parseToolsetRows([{ ...RAW[0], enabled: true }])[0])).toBe("never");
  });

  it("reads the server status object and never infers OK from last use", () => {
    const [failing] = parseToolsetRows([
      {
        ...RAW[0],
        enabled: true,
        last_used_at: 9,
        status: { state: "failing", since: 5, last_error: "The server did not answer." },
      },
    ]);
    expect(healthOf(failing)).toBe("failing");
    expect(failing.failingSince).toBe(5);
    expect(failing.lastError).toBe("The server did not answer.");
    const [never] = parseToolsetRows([
      { ...RAW[0], enabled: true, last_used_at: 9, status: { state: "never_used" } },
    ]);
    expect(healthOf(never)).toBe("never");
    const [unknown] = parseToolsetRows([
      { ...RAW[0], enabled: true, last_used_at: 9, status: { state: "weird" } },
    ]);
    expect(healthOf(unknown)).toBe("never");
    expect(parseToolsetRows([{ ...RAW[0], status: "ok" }])[0].health).toBeUndefined();
  });

  it("flags both toolsets that reach the agent under one name", () => {
    expect([...clashingNames(parseToolsetRows(RAW))]).toEqual(["my-tool"]);
  });

  it("marks a CLI toolset with no approval and no allow-list", () => {
    const rows = parseToolsetRows(RAW);
    expect(rows.map(runsWithoutApproval)).toEqual([false, false, true]);
  });

  it("searches the displayed kind label, name and description", () => {
    const [mcp] = parseToolsetRows(RAW);
    expect(matchesToolset(mcp, "MCP server", "MCP server")).toBe(true);
    expect(matchesToolset(mcp, "pages", "MCP server")).toBe(true);
    expect(matchesToolset(mcp, "skill", "MCP server")).toBe(false);
    expect(matchesToolset(mcp, "  ", "MCP server")).toBe(true);
  });
});
