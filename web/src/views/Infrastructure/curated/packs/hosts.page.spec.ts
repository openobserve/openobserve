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

// Hosts content pack — the drawer's 8-panel grid expressed as a manifest
// (design §7.3). Ids, titles and units are FROZEN against the pre-retrofit
// builder; the frozen golden fixture is the behavioural half of that contract.

import { describe, it, expect } from "vitest";
import { hostsPage } from "./hosts.page";
import { GROUP, STALENESS_24H_US } from "../types";
import golden from "./__fixtures__/hostDashboard.golden.json";

const allPanels = () => hostsPage.sections.flatMap((section: any) => section.panels);

const panel = (id: string) => {
  const found = allPanels().find((p: any) => p.id === id);
  if (!found) throw new Error(`panel ${id} is not in the hosts pack`);
  return found;
};

/** The frozen builder output, the reference for every identity assertion below. */
const goldenPanels = (golden as any).tabs[0].panels as any[];

describe("hosts pack — one section, one group, always pinned", () => {
  it("declares exactly one requirement group on the hostmetrics collector", () => {
    expect(hostsPage.id).toBe("hosts");
    expect(hostsPage.groups.map((g: any) => g.id)).toEqual(["hostmetrics"]);
    expect(hostsPage.groups[0].streamType).toBe("metrics");
    expect(hostsPage.groups[0].setup).toEqual({ kind: "card", slug: "linux" });
  });

  it("declares the host picker so a future UNPINNED hosts page can reuse the pack", () => {
    expect(hostsPage.scopePickers).toHaveLength(1);
    expect(hostsPage.scopePickers[0].name).toBe("host");
    expect(hostsPage.scopePickers[0].group).toBe(GROUP.host);
  });

  it("declares exactly one section, whose id is `host`", () => {
    expect(hostsPage.sections.map((s: any) => s.id)).toEqual(["host"]);
  });

  it("pins the 24h staleness threshold like every pack", () => {
    expect(hostsPage.stalenessThresholdUs).toBe(STALENESS_24H_US);
  });
});

describe("pass-4 finding 17 — the override that keeps the drawer's open synchronous", () => {
  it("fieldOverrides pins the `host` group to host_name", () => {
    // Not merely an optimisation: the `host` group's fields are ordered
    // host, hostname, node, node_name, host_name — host_name is FIFTH, so rung 2
    // on a stream also carrying a bare `host` would silently rewrite all 8 queries.
    expect(hostsPage.groups[0].fieldOverrides).toEqual({ [GROUP.host]: "host_name" });
    expect(GROUP.host).toBe("host");
  });

  it("keeps anchorStream declared as the fallback for a future unpinned view", () => {
    expect(hostsPage.groups[0].anchorStream).toBe("system_cpu_time");
  });
});

describe("panel identity — frozen against the pre-retrofit builder", () => {
  it("declares exactly the builder's 8 panels, in order", () => {
    expect(allPanels().map((p: any) => p.id)).toEqual([
      "hd_cpu_busy",
      "hd_cpu_by_state",
      "hd_memory_by_state",
      "hd_load",
      "hd_disk_read",
      "hd_disk_write",
      "hd_fs_used_pct",
      "hd_network_by_direction",
    ]);
    expect(allPanels().map((p: any) => p.id)).toEqual(goldenPanels.map((p) => p.id));
  });

  it("every panel's type and unit match the golden fixture's", () => {
    for (const p of allPanels()) {
      const reference = goldenPanels.find((g) => g.id === p.id)!;
      expect(p.type, p.id).toBe(reference.type);
      expect(p.unit, p.id).toBe(reference.config.unit);
    }
  });

  it("reuses the existing infra.hosts.panel.* title keys verbatim — no new copy", () => {
    expect(allPanels().map((p: any) => p.titleKey)).toEqual([
      "infra.hosts.panel.cpuBusy",
      "infra.hosts.panel.cpuByState",
      "infra.hosts.panel.memoryByState",
      "infra.hosts.panel.load",
      "infra.hosts.panel.diskRead",
      "infra.hosts.panel.diskWrite",
      "infra.hosts.panel.filesystemUsedPct",
      "infra.hosts.panel.networkByDirection",
    ]);
  });
});

describe("variants declare their FULL stream set (§4.1)", () => {
  it("each panel requires exactly the system_* streams its queries read", () => {
    const expected: Record<string, string[]> = {
      hd_cpu_busy: ["system_cpu_time"],
      hd_cpu_by_state: ["system_cpu_time"],
      hd_memory_by_state: ["system_memory_usage"],
      hd_load: [
        "system_cpu_load_average_1m",
        "system_cpu_load_average_5m",
        "system_cpu_load_average_15m",
      ],
      hd_disk_read: ["system_disk_io"],
      hd_disk_write: ["system_disk_io"],
      hd_fs_used_pct: ["system_filesystem_usage"],
      hd_network_by_direction: ["system_network_io"],
    };
    for (const [id, streams] of Object.entries(expected)) {
      expect(panel(id).variants, id).toHaveLength(1);
      expect(panel(id).variants[0].requiresStreams, id).toEqual(streams);
    }
  });

  it("hd_load keeps all THREE queries — a single-query collapse loses two series", () => {
    expect(panel("hd_load").variants[0].queries).toHaveLength(3);
    expect(panel("hd_load").variants[0].queries.map((q: any) => q.legend)).toEqual([
      "1m",
      "5m",
      "15m",
    ]);
  });
});

describe("queries carry tokens, not literals", () => {
  it("every query pins the host through ${scope:host}, never a hardcoded matcher", () => {
    for (const p of allPanels()) {
      for (const variant of p.variants) {
        for (const q of variant.queries) {
          expect(q.query, p.id).toContain("${scope:host}");
          // The literal interpolation is exactly what the retrofit replaces.
          expect(q.query, p.id).not.toContain('host_name="');
        }
      }
    }
  });

  it("preserves the device/filesystem exclusions the builder carried", () => {
    expect(panel("hd_disk_read").variants[0].queries[0].query).toContain('device!~"loop.*"');
    expect(panel("hd_disk_write").variants[0].queries[0].query).toContain('device!~"loop.*"');
    expect(panel("hd_fs_used_pct").variants[0].queries[0].query).toContain("device!~");
  });

  it("keeps the state selectors the builder used, character for character", () => {
    expect(panel("hd_cpu_busy").variants[0].queries[0].query).toContain('state="idle"');
    expect(panel("hd_cpu_by_state").variants[0].queries[0].query).toContain('state!="idle"');
    expect(panel("hd_fs_used_pct").variants[0].queries[0].query).toContain('state="used"');
  });
});
