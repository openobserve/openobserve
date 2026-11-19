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
  paramsFromUrl,
  presetBadge,
  presetData,
  presetDiff,
  renderUrl,
  reviewUpdate,
  valueHash,
  type Preset,
} from "./presets";

const datadog = (revision: number, over: Partial<Preset> = {}): Preset => ({
  id: "datadog",
  kind: "mcp",
  label: "Datadog",
  revision,
  description: "Datadog v" + revision,
  url_template: "https://mcp.{site}/v1/mcp",
  params: [{ name: "site", label: "Site", default: "datadoghq.com" }],
  allowed_tools: ["search_datadog_logs"],
  write_tools: [],
  tool_classes: [{ tool: "search_datadog_logs", class: "logs" }],
  ...over,
});

describe("presets", () => {
  it("renders the URL template and keeps no copy of the URL in the preset", () => {
    expect(renderUrl("https://mcp.{site}/x/{site}", { site: "datadoghq.eu" })).toBe(
      "https://mcp.datadoghq.eu/x/datadoghq.eu",
    );
    const data = presetData(datadog(1), { site: "datadoghq.eu" });
    expect(data).toEqual({
      url: "https://mcp.datadoghq.eu/v1/mcp",
      allowed_tools: ["search_datadog_logs"],
      write_tools: [],
      tool_classes: [{ tool: "search_datadog_logs", class: "logs" }],
      preset: { id: "datadog", revision: 1 },
    });
    expect(paramsFromUrl("https://mcp.{site}/v1/mcp", data.url)).toEqual({ site: "datadoghq.eu" });
    expect(paramsFromUrl("{url}", "https://g.example/mcp?t=1")).toEqual({
      url: "https://g.example/mcp?t=1",
    });
    expect(paramsFromUrl("https://mcp.{site}/v2/mcp", data.url)).toBeNull();
  });

  it("flags a newer shipped revision and a retired preset", () => {
    const row = { preset: { id: "datadog", revision: 1 } };
    expect(presetBadge(row, [datadog(1)])).toBeNull();
    expect(presetBadge(row, [datadog(2)])).toBe("updated");
    expect(presetBadge(row, [])).toBe("retired");
    expect(presetBadge({ url: "x" }, [datadog(2)])).toBeNull();
    expect(presetBadge(row, undefined)).toBeNull();
  });

  const savedRow = () => ({
    description: "Datadog v1",
    data: {
      ...presetData(datadog(1), { site: "datadoghq.eu" }),
      headers: { DD_API_KEY: "***" },
      max_calls_per_turn: 10,
    },
  });

  it("rebuilds the URL from the row's own URL, and leaves out a URL that no longer fits", () => {
    const moved = datadog(2, { url_template: "https://mcp.{site}/v1/mcp?toolsets=all" });
    expect(presetDiff(savedRow(), moved).find((d) => d.field === "url")).toBeUndefined();
    const sameShape = datadog(2, { allowed_tools: ["a"] });
    expect(presetDiff(savedRow(), sameShape).map((d) => d.field)).toEqual([
      "description",
      "allowed_tools",
    ]);
  });

  it("applies some fields and never sends credentials, limits or the URL's parts", () => {
    const row = savedRow();
    const v2 = datadog(2, { allowed_tools: ["a", "b"] });
    const diffs = presetDiff(row, v2);
    const body = reviewUpdate(row, v2, diffs, new Set(["allowed_tools"]));
    expect(body).toEqual({
      data: {
        allowed_tools: ["a", "b"],
        preset: { id: "datadog", revision: 2, skipped: { description: valueHash("Datadog v2") } },
      },
    });
    const applied = { ...row, data: { ...row.data, ...body.data } };
    expect(presetBadge(applied.data, [v2])).toBeNull();
    expect(presetDiff(applied, v2)).toEqual([]);
  });

  it("holds a skip across revisions until the skipped value changes", () => {
    let row: any = savedRow();
    const save = (preset: Preset, applied: string[]) => {
      const body = reviewUpdate(row, preset, presetDiff(row, preset), new Set(applied as any));
      row = {
        description: body.description ?? row.description,
        data: { ...row.data, ...body.data },
      };
    };
    const v2 = datadog(2, { description: "Datadog v1", allowed_tools: ["a", "b"] });
    expect(presetDiff(row, v2).map((d) => d.field)).toEqual(["allowed_tools"]);
    save(v2, []);
    const v3 = datadog(3, { description: "Datadog v3", allowed_tools: ["a", "b"] });
    expect(presetDiff(row, v3).map((d) => d.field)).toEqual(["description"]);
    save(v3, ["description"]);
    const v4 = datadog(4, { description: "Datadog v3", allowed_tools: ["a", "b", "c"] });
    expect(presetDiff(row, v4).map((d) => d.field)).toEqual(["allowed_tools"]);
    expect(row.data.allowed_tools).toEqual(["search_datadog_logs"]);
    save(v4, ["allowed_tools"]);
    expect(row.data.preset.skipped).toEqual({});
  });

  it("reviews a CLI preset's command and subcommands, never its credentials", () => {
    const kubectl: Preset = {
      id: "kubectl",
      kind: "cli",
      label: "kubectl",
      revision: 2,
      command: "kubectl",
      allowed_subcommands: ["get", "describe", "logs"],
      env: [],
      credential_files: ["KUBECONFIG"],
    };
    const row = {
      description: "",
      data: {
        command: "kubectl",
        allowed_subcommands: ["get"],
        credential_files: { KUBECONFIG: "***" },
        preset: { id: "kubectl", revision: 1 },
      },
    };
    const diffs = presetDiff(row, kubectl);
    expect(diffs.map((d) => d.field)).toEqual(["allowed_subcommands"]);
    const body = reviewUpdate(row, kubectl, diffs, new Set(["allowed_subcommands"]));
    expect(body.data).toEqual({
      allowed_subcommands: ["get", "describe", "logs"],
      preset: { id: "kubectl", revision: 2, skipped: {} },
    });
  });
});
