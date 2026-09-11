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
