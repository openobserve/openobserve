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

import reference from "./fixtures/nginxLines.json";
import {
  addedFields,
  detectFormat,
  OFFERED_FORMATS,
  parserSource,
  queryReadsStream,
  repairName,
  repairPipeline,
  streamReaders,
  type NginxFormat,
} from "./nginxParse";
import { isNginxLine } from "./rawLogs";

const FORMATS = Object.keys(reference) as NginxFormat[];
const VRL_URL = process.env.O2_VRL_URL ?? "";
const VRL_AUTH = process.env.O2_VRL_AUTH ?? "";

describe("parser gate", () => {
  it.each(FORMATS)("%s has 5 anonymised reference lines with recorded fields", (format) => {
    const lines = reference[format];
    expect(lines).toHaveLength(5);
    for (const { line, fields } of lines) {
      expect(isNginxLine(line)).toBe(true);
      expect(detectFormat([line])).toBe(format);
      expect(Object.keys(fields).length).toBeGreaterThan(3);
      expect(fields).not.toHaveProperty("message");
      expect(line).not.toMatch(/\b(10|172|127)\.\d+\.\d+\.\d+\b/);
    }
  });

  it("offers exactly the formats that have a full reference set", () => {
    expect(OFFERED_FORMATS).toEqual(FORMATS.filter((format) => reference[format].length === 5));
  });

  // Needs a running server: O2_VRL_URL=http://host:port/api/org O2_VRL_AUTH="Basic ..."
  it.runIf(VRL_URL).each(FORMATS)("%s parses 5 of 5 through functions/test", async (format) => {
    const lines = reference[format];
    const response = await fetch(`${VRL_URL}/functions/test`, {
      method: "POST",
      headers: { Authorization: VRL_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        function: parserSource(format, "message"),
        events: lines.map(({ line }) => ({ message: line })),
        trans_type: 0,
      }),
    });
    const { results } = await response.json();
    const passed = lines.filter(
      ({ line, fields }, index) =>
        results[index].event.message === line &&
        JSON.stringify(addedFields({ message: line }, results[index].event)) ===
          JSON.stringify(fields),
    );
    expect(passed).toHaveLength(5);
  });
});

describe("parserSource", () => {
  it("merges the parsed fields under the record, so existing fields win", () => {
    const source = parserSource("combined", "log");
    expect(source).toContain('parse_nginx_log(.log, "combined")');
    expect(source).toContain(". = merge(parsed, .)");
    expect(source).not.toMatch(/del\(\.|\.log =/);
  });

  it("renames the error text and drops its zone-less time", () => {
    const source = parserSource("error", "message");
    expect(source).toContain("parsed.error_message = del(parsed.message)");
    expect(source).toContain("del(parsed.timestamp)");
  });
});

describe("detectFormat", () => {
  it("picks the format most lines share", () => {
    const [combined] = reference.combined;
    const [error] = reference.error;
    expect(detectFormat([combined.line, combined.line, error.line])).toBe("combined");
  });

  it("gives null for text that is not Nginx", () => {
    expect(detectFormat(["user 1 signed in", "hello"])).toBeNull();
    expect(detectFormat([])).toBeNull();
  });
});

describe("addedFields", () => {
  it("keeps only keys the record did not have", () => {
    expect(
      addedFields({ message: "a", status: 1 }, { message: "a", status: 2, path: "/" }),
    ).toEqual({ path: "/" });
  });
});

describe("repairPipeline", () => {
  it("reads the stream, runs the function, and writes back to the same stream", () => {
    const name = repairName("Edge-Logs.1");
    expect(name).toMatch(/^starter_pack_nginx_edge_logs_1_[0-9a-f]+$/);
    const pipeline = repairPipeline("org", "Edge-Logs.1", name);
    expect(pipeline.source).toEqual({ source_type: "realtime" });
    const [input, fn, output] = pipeline.nodes;
    expect(input.data).toMatchObject({ stream_name: "Edge-Logs.1", node_type: "stream" });
    expect(fn.data).toMatchObject({ node_type: "function", name });
    expect(output.data).toMatchObject({ stream_name: "Edge-Logs.1", node_type: "stream" });
    expect(pipeline.edges.map(({ source, target }) => `${source}>${target}`)).toEqual([
      "input>parse",
      "parse>output",
    ]);
  });
});

describe("repairName", () => {
  it("gives streams that share a slug different names", () => {
    const names = ["nginx-prod", "nginx_prod", "Nginx_Prod"].map(repairName);
    expect(new Set(names).size).toBe(3);
    expect(repairName("nginx-prod")).toBe(names[0]);
  });

  it("caps a long stream name", () => {
    expect(repairName("x".repeat(500)).length).toBeLessThanOrEqual(60);
  });
});

describe("streamReaders", () => {
  const panel = (query: Record<string, unknown>) => ({ queries: [query] });
  const sources = {
    dashboards: [
      {
        version: 8,
        title: "Edge",
        v8: { tabs: [{ panels: [panel({ fields: { stream: "edge" } })] }] },
      },
      {
        version: 8,
        title: "Sql",
        v8: { tabs: [{ panels: [panel({ query: 'SELECT * FROM "edge"' })] }] },
      },
      {
        version: 8,
        title: "Other",
        v8: { tabs: [{ panels: [panel({ query: "SELECT * FROM edge_2" })] }] },
      },
    ],
    alerts: [
      { name: "5xx", stream_name: "edge", stream_type: "logs" },
      { name: "metric", stream_name: "edge", stream_type: "metrics" },
    ],
    savedViews: [
      { view_name: "Edge view", data: { data: { stream: { selectedStream: ["edge"] } } } },
      { view_name: "App view", data: { data: { stream: { selectedStream: ["app"] } } } },
    ],
    pipelines: [
      {
        name: "existing",
        source: { source_type: "realtime", stream_name: "edge", stream_type: "logs" },
        nodes: [],
      },
      {
        name: "scheduled",
        source: { source_type: "scheduled" },
        nodes: [{ io_type: "input", data: { node_type: "stream", stream_name: "edge" } }],
      },
    ],
  };

  it("lists dashboards, alerts, saved views and pipelines that read the stream", () => {
    expect(streamReaders(sources, "edge")).toEqual([
      { kind: "dashboard", name: "Edge" },
      { kind: "dashboard", name: "Sql" },
      { kind: "alert", name: "5xx" },
      { kind: "savedView", name: "Edge view" },
      { kind: "pipeline", name: "existing", realtimeSource: true },
      { kind: "pipeline", name: "scheduled", realtimeSource: false },
    ]);
  });

  it("gives nothing for a stream no one reads", () => {
    expect(streamReaders(sources, "quiet")).toEqual([]);
  });

  it("matches the stream name in FROM only as a whole name", () => {
    expect(queryReadsStream("select * from edge where a=1", "edge")).toBe(true);
    expect(queryReadsStream("select * from edge_2", "edge")).toBe(false);
    expect(queryReadsStream(undefined, "edge")).toBe(false);
  });
});
