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
import { b64DecodeUnicode } from "@/utils/formatters";

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

describe("the drawer's panels agree with the list's columns", () => {
  // Stated literally, not imported: interpolating the constant under test would
  // make a typo'd label name pass.
  const GUARD = 'instrumentation_library_name!~".*instrumentation.system_metrics.*"';

  const panelQueries = () =>
    allPanels().flatMap((p: any) =>
      p.variants.flatMap((v: any) => v.queries.map((q: any) => q.query)),
    );

  // The drilldown carries its query base64'd inside the explorer URL.
  const drilldownQueries = () =>
    allPanels().flatMap((p: any) =>
      (p.drilldown ?? []).map((d: any) => {
        const encoded = new URLSearchParams(d.data.url.split("?")[1]).get("query") ?? "";
        return b64DecodeUnicode(encoded) ?? "";
      }),
    );

  it("every panel query excludes language-SDK process metrics", () => {
    const queries = panelQueries();
    expect(queries.length).toBe(10);
    for (const q of queries) expect(q, q).toContain(GUARD);
  });

  it("drilldowns carry the same exclusion, so the explorer matches the panel", () => {
    for (const q of drilldownQueries()) expect(q, q).toContain(GUARD);
  });

  it("the filesystem panel drops firmware mountpoints like the Disk column does", () => {
    const q = panel("hd_fs_used_pct").variants[0].queries[0].query;
    expect([...q.matchAll(/mountpoint!~"([^"]*)"/g)].map((m: any) => m[1])).toEqual([
      "/boot.*|/efi.*",
      "/boot.*|/efi.*",
    ]);
  });

  it("no panel query carries a backslash escape the metrics engine rejects", () => {
    for (const q of [...panelQueries(), ...drilldownQueries()]) expect(q, q).not.toContain("\\");
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
    expect(panel("hd_disk_read").variants[0].queries[0].query).toContain("device!~");
    expect(panel("hd_disk_write").variants[0].queries[0].query).toContain("device!~");
    expect(panel("hd_fs_used_pct").variants[0].queries[0].query).toContain("device!~");
  });

  // Run the SHIPPED matcher against real device names: a pattern anchored on a
  // trailing digit blanks the panel on every nvme host, which reads as no data.
  const deviceMatcher = (panelId: string) => {
    const m = panel(panelId).variants[0].queries[0].query.match(/device!~"([^"]*)"/);
    if (!m) throw new Error(`no device matcher on ${panelId}`);
    return new RegExp(`^(?:${m[1]})$`);
  };

  it.each(["hd_disk_read", "hd_disk_write"])("%s keeps whole disks and drops partitions", (id) => {
    const re = deviceMatcher(id);
    for (const keep of ["nvme0n1", "nvme1n1", "nvme14n1", "sda", "sdb", "sdd", "xvda"]) {
      expect(re.test(keep), `${keep} must survive`).toBe(false);
    }
    for (const drop of ["nvme0n1p1", "nvme0n1p128", "sda1", "sda15", "sdb1", "xvda1", "sr0"]) {
      expect(re.test(drop), `${drop} must be excluded`).toBe(true);
    }
  });

  it("the filesystem panel groups by device so a bind mount is one line", () => {
    const query = panel("hd_fs_used_pct").variants[0].queries[0].query;
    expect(query).toContain("sum by (device)");
    expect(query).not.toContain("sum by (mountpoint)");
  });

  // This panel sums ACROSS devices, so a virtual interface lands in the total.
  it("the network panel excludes loopback and virtual interfaces", () => {
    const query = panel("hd_network_by_direction").variants[0].queries[0].query;
    const m = query.match(/device!~"([^"]*)"/);
    expect(m, "network panel must carry a device exclusion").toBeTruthy();
    const re = new RegExp(`^(?:${m![1]})$`);
    for (const drop of ["lo", "veth123abc", "docker0", "br-abc123", "cni0", "flannel.1", "tunl0"]) {
      expect(re.test(drop), `${drop} must be excluded`).toBe(true);
    }
    for (const keep of ["eth0", "ens5", "enp0s3"]) {
      expect(re.test(keep), `${keep} must survive`).toBe(false);
    }
  });

  it("keeps the state selectors the builder used, character for character", () => {
    expect(panel("hd_cpu_busy").variants[0].queries[0].query).toContain('state="idle"');
    expect(panel("hd_cpu_by_state").variants[0].queries[0].query).toContain('state!="idle"');
    expect(panel("hd_fs_used_pct").variants[0].queries[0].query).toContain('state="used"');
  });
});
