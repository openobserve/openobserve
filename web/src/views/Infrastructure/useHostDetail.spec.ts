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

// The host logs preview resolves its stream and host field from evidence
// (schemas + the org's semantic host group), never from a hardcoded guess.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLogsPreviewSql, resolveHostLogsTarget, useHostLogsTarget } from "./useHostDetail";
import useStreams from "@/composables/useStreams";
import { __resetSchemaReadsForTest } from "./curated/useCuratedPage";
import { loadSemanticGroups } from "@/utils/semanticGroupsCache";

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({ getStreams: getStreamsMock, getStream: getStreamMock })),
}));

vi.mock("@/utils/semanticGroupsCache", () => ({ loadSemanticGroups: vi.fn() }));

const getStreamsMock = vi.fn();
const getStreamMock = vi.fn();

const HOST_ALIASES = [
  "host",
  "hostname",
  "node",
  "node_name",
  "host_name",
  "resource_attributes_host_name",
  "k8s_node_name",
];

const entry = (name: string, fields: string[]) => ({
  name,
  schema: fields.map((f) => ({ name: f })),
});

describe("resolveHostLogsTarget — evidence, not a guess", () => {
  it("picks the log stream that actually carries a host field", () => {
    const target = resolveHostLogsTarget({
      streams: [
        entry("audit", ["_timestamp", "user"]),
        entry("syslog", ["_timestamp", "hostname", "message"]),
      ],
      hostFieldAliases: HOST_ALIASES,
    });
    expect(target.stream).toBe("syslog");
    expect(target.field).toBe("hostname");
  });

  it("never invents a stream named 'default' when no stream carries a host field", () => {
    const target = resolveHostLogsTarget({
      streams: [entry("audit", ["_timestamp", "user"])],
      hostFieldAliases: HOST_ALIASES,
    });
    expect(target.stream).toBeNull();
    expect(target.field).toBeNull();
    expect(target.reason).toBe("no-host-field");
  });

  it("reports an empty log-stream list as its own case, not as a missing field", () => {
    const target = resolveHostLogsTarget({ streams: [], hostFieldAliases: HOST_ALIASES });
    expect(target.stream).toBeNull();
    expect(target.reason).toBe("no-log-streams");
  });

  it("honours the org's alias order so the dictionary decides, not this file", () => {
    // One stream carrying TWO aliases must resolve to the earlier-ranked one.
    const target = resolveHostLogsTarget({
      streams: [entry("app", ["_timestamp", "host_name", "hostname"])],
      hostFieldAliases: HOST_ALIASES,
    });
    expect(target.field).toBe("hostname");
  });

  it("prefers a stream that ranks a better alias over one that merely matches", () => {
    const target = resolveHostLogsTarget({
      streams: [entry("late", ["_timestamp", "node_name"]), entry("early", ["_timestamp", "host"])],
      hostFieldAliases: HOST_ALIASES,
    });
    expect(target.stream).toBe("early");
  });

  it("ignores a stream whose schema has not been read rather than assuming it matches", () => {
    const target = resolveHostLogsTarget({
      streams: [{ name: "unread" }],
      hostFieldAliases: HOST_ALIASES,
    });
    expect(target.stream).toBeNull();
  });

  // Rank order is not relevance: `_o2_dbm_server` carries a host-shaped column and
  // ranked first, so a real org's drawer offered a database-monitoring rollup as
  // "this host's logs". The backend calls the `_o2_` family internal by PREFIX
  // (config/src/meta/self_reporting/usage.rs:99 is_internal_rollup_stream).
  describe("internal rollup streams are not a host's logs", () => {
    it("never picks an _o2_ stream even when it ranks the best alias", () => {
      const target = resolveHostLogsTarget({
        streams: [
          entry("_o2_dbm_server", ["_timestamp", "host"]),
          entry("applogs", ["_timestamp", "host_name", "log"]),
        ],
        hostFieldAliases: HOST_ALIASES,
      });
      expect(target.stream).toBe("applogs");
      expect(target.field).toBe("host_name");
    });

    it("excludes the whole _o2_ family, not just the DBM stream", () => {
      for (const name of ["_o2_db_stats", "_o2_service_graph", "_o2_dbm_server"]) {
        const target = resolveHostLogsTarget({
          streams: [entry(name, ["_timestamp", "host"])],
          hostFieldAliases: HOST_ALIASES,
        });
        expect(target.stream).toBeNull();
      }
    });

    it("excludes the pre-prefix-era _agent_signals alongside the _o2_ family", () => {
      const target = resolveHostLogsTarget({
        streams: [entry("_agent_signals", ["_timestamp", "host"])],
        hostFieldAliases: HOST_ALIASES,
      });
      expect(target.stream).toBeNull();
    });

    // Honest reason: the org HAS log streams, they are just all ours. "no host
    // field" would blame the user's schema for our own filter.
    it("reports an all-internal org as no-log-streams, not as a missing field", () => {
      const target = resolveHostLogsTarget({
        streams: [entry("_o2_dbm_server", ["_timestamp", "host"])],
        hostFieldAliases: HOST_ALIASES,
      });
      expect(target.reason).toBe("no-log-streams");
    });

    it("leaves an ordinary stream that merely starts with o2 alone", () => {
      const target = resolveHostLogsTarget({
        streams: [entry("o2_stuff", ["_timestamp", "host"])],
        hostFieldAliases: HOST_ALIASES,
      });
      expect(target.stream).toBe("o2_stuff");
    });
  });

  // A stream with a host column but no rows in the window is not this host's logs.
  // Stats come free on the LIST read, so this costs no extra request.
  describe("a stream that never reported is not a candidate", () => {
    it("prefers a stream with rows over a better-ranked empty one", () => {
      const target = resolveHostLogsTarget({
        streams: [
          { ...entry("empty", ["_timestamp", "host"]), stats: { doc_num: 0 } },
          { ...entry("applogs", ["_timestamp", "host_name"]), stats: { doc_num: 4200 } },
        ],
        hostFieldAliases: HOST_ALIASES,
      });
      expect(target.stream).toBe("applogs");
    });

    it("still resolves when no candidate carries stats at all", () => {
      const target = resolveHostLogsTarget({
        streams: [entry("applogs", ["_timestamp", "host_name"])],
        hostFieldAliases: HOST_ALIASES,
      });
      expect(target.stream).toBe("applogs");
    });
  });
});

describe("useHostLogsTarget — resolves against the org's own streams and dictionary", () => {
  beforeEach(() => {
    vi.mocked(useStreams).mockReturnValue({
      getStreams: getStreamsMock,
      getStream: getStreamMock,
    } as any);
    getStreamsMock.mockReset();
    getStreamMock.mockReset();
    vi.mocked(loadSemanticGroups).mockReset();
    // Schema reads are cached MODULE-side, so one case's reads would answer the next one's.
    __resetSchemaReadsForTest();
  });

  it("reads the org's host aliases rather than assuming a field spelling", async () => {
    getStreamsMock.mockResolvedValue({ list: [{ name: "syslog" }] });
    getStreamMock.mockResolvedValue({ name: "syslog", schema: [{ name: "resource_host" }] });
    vi.mocked(loadSemanticGroups).mockResolvedValue([
      { id: "host", display: "Host", fields: ["resource_host"] },
    ] as any);

    const resolved = await useHostLogsTarget().resolve("org-1");
    expect(resolved.stream).toBe("syslog");
    expect(resolved.field).toBe("resource_host");
  });

  it("reports no-host-field when the org's log streams carry none of the aliases", async () => {
    getStreamsMock.mockResolvedValue({ list: [{ name: "audit" }] });
    getStreamMock.mockResolvedValue({ name: "audit", schema: [{ name: "user" }] });
    vi.mocked(loadSemanticGroups).mockResolvedValue([
      { id: "host", display: "Host", fields: ["host_name"] },
    ] as any);

    const resolved = await useHostLogsTarget().resolve("org-1");
    expect(resolved.stream).toBeNull();
    expect(resolved.reason).toBe("no-host-field");
  });

  it("survives a failed schema read by dropping that candidate, not the whole resolve", async () => {
    getStreamsMock.mockResolvedValue({ list: [{ name: "broken" }, { name: "syslog" }] });
    getStreamMock.mockImplementation(async (name: string) => {
      if (name === "broken") throw new Error("schema unavailable");
      return { name, schema: [{ name: "host_name" }] };
    });
    vi.mocked(loadSemanticGroups).mockResolvedValue([
      { id: "host", display: "Host", fields: ["host_name"] },
    ] as any);

    const resolved = await useHostLogsTarget().resolve("org-1");
    expect(resolved.stream).toBe("syslog");
  });

  // On a COLD store getStreams() forces schema=false (useStreams.ts:66), so every
  // getStream(..., true) is a real StreamService.schema request, not a cache hit.
  describe("schema reads are bounded, not one per stream in the org", () => {
    const bigOrg = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ name: `stream_${i}` }));

    beforeEach(() => {
      vi.mocked(loadSemanticGroups).mockResolvedValue([
        { id: "host", display: "Host", fields: ["host_name"] },
      ] as any);
    });

    it("does not read a schema for every stream in a 200-stream org", async () => {
      getStreamsMock.mockResolvedValue({ list: bigOrg(200) });
      getStreamMock.mockResolvedValue({ name: "x", schema: [{ name: "host_name" }] });

      await useHostLogsTarget().resolve("org-1");
      expect(getStreamMock.mock.calls.length).toBeLessThanOrEqual(25);
    });

    it("never reads a schema for an internal rollup stream", async () => {
      getStreamsMock.mockResolvedValue({
        list: [{ name: "_o2_dbm_server" }, { name: "_o2_db_stats" }, { name: "applogs" }],
      });
      getStreamMock.mockResolvedValue({ name: "applogs", schema: [{ name: "host_name" }] });

      await useHostLogsTarget().resolve("org-1");
      const read = getStreamMock.mock.calls.map((call: any[]) => call[0]);
      expect(read).not.toContain("_o2_dbm_server");
      expect(read).not.toContain("_o2_db_stats");
    });
  });
});

describe("buildLogsPreviewSql — quotes the resolved stream and field", () => {
  it("builds against the resolved stream and the resolved host field", () => {
    const sql = buildLogsPreviewSql("web-01", { stream: "syslog", field: "hostname" });
    expect(sql).toContain('FROM "syslog"');
    expect(sql).toContain("hostname = 'web-01'");
    expect(sql).not.toContain('"default"');
  });

  it("escapes a quote in the host name so the predicate cannot be broken out of", () => {
    const sql = buildLogsPreviewSql("we'b", { stream: "syslog", field: "hostname" });
    expect(sql).toContain("hostname = 'we''b'");
  });
});
