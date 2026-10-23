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

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("./kubernetesDashboards", async () => ({
  buildKubernetesDashboards: (await import("./__fixtures__/kubernetesDashboardsStub"))
    .stubKubernetesDashboards,
}));

import dashboards from "@/services/dashboards";
import settings from "@/services/settings";
import { queryClient } from "@/composables/query/queryClient";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { folderKeys } from "@/services/common.querykeys";
import { installReadyMade } from "./installReadyMade";
import { resetReadyMadeSessionMemory } from "./readyMadeSettings";

const ORG = "org1";
const svc = dashboards as unknown as Record<string, ReturnType<typeof vi.fn>>;
const settingsSvc = settings as unknown as Record<string, ReturnType<typeof vi.fn>>;

interface Row {
  dashboard_id: string;
  folder_id: string;
  folder_name: string;
  title: string;
  role: string;
  created: string;
}

/** A tiny in-memory backend: folders by name, dashboards with a title search. */
let rows: Row[];
let folders: Map<string, { folderId: string; name: string }>;
let nextId: number;
let clock: number;

const forbidden = () => Object.assign(new Error("403"), { response: { status: 403 } });

const installBackend = () => {
  rows = [];
  folders = new Map();
  nextId = 1;
  clock = Date.parse("2026-10-12T10:00:00Z");
  svc.list.mockImplementation(async (...args: any[]) => {
    const title = String(args[7] ?? "").toLowerCase();
    return {
      data: { dashboards: rows.filter((row) => row.title.toLowerCase().includes(title)) },
    };
  });
  svc.get_Folder_By_Name.mockImplementation(async (_org: string, name: string) => {
    const folder = folders.get(name);
    if (!folder) throw Object.assign(new Error("404"), { response: { status: 404 } });
    return { data: folder };
  });
  svc.new_Folder.mockImplementation(async (_org: string, data: any) => {
    if (folders.has(data.name))
      throw Object.assign(new Error("dup"), { response: { status: 409 } });
    const folder = { folderId: `f-${data.name}`, name: data.name };
    folders.set(data.name, folder);
    return { data: folder };
  });
  svc.create.mockImplementation(async (_org: string, doc: any, folderId: string) => {
    const id = `d${nextId++}`;
    clock += 1000;
    rows.push({
      dashboard_id: id,
      folder_id: folderId,
      folder_name: [...folders.values()].find((f) => f.folderId === folderId)?.name ?? folderId,
      title: doc.title,
      role: doc.role,
      created: new Date(clock).toISOString(),
    });
    return { data: { version: 8, v8: { dashboardId: id } } };
  });
  svc.delete.mockImplementation(async (_org: string, id: string) => {
    rows = rows.filter((row) => row.dashboard_id !== id);
    return {};
  });
};

const seedCopy = (over: Partial<Row>): Row => {
  const row: Row = {
    dashboard_id: `seed-${rows.length}`,
    folder_id: "team",
    folder_name: "Team",
    title: "PostgreSQL / Overview",
    role: "ready-made:postgresql/overview:1",
    created: "2026-01-01T00:00:00Z",
    ...over,
  };
  rows.push(row);
  return row;
};

describe("installReadyMade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    resetReadyMadeSessionMemory();
    installBackend();
    settingsSvc.getSetting.mockRejectedValue(
      Object.assign(new Error("404"), { response: { status: 404 } }),
    );
    settingsSvc.setUserSetting.mockResolvedValue({});
  });

  it("creates the source's folder and a marked copy in it, then remembers 'added'", async () => {
    const result = await installReadyMade(ORG, "postgresql", { userId: "me@x.io" });

    expect(svc.new_Folder).toHaveBeenCalledWith(
      ORG,
      { name: "PostgreSQL", description: "", icon: "o2:postgresql" },
      { silentForbidden: true },
    );
    expect(svc.create).toHaveBeenCalledTimes(1);
    const [, doc, folderId, options] = svc.create.mock.calls[0];
    expect(folderId).toBe("f-PostgreSQL");
    expect(options).toEqual({ silentForbidden: true });
    expect(doc.title).toBe("PostgreSQL / Overview");
    expect(doc.role).toBe("ready-made:postgresql/overview:1");
    expect(result).toEqual({
      status: "created",
      sourceId: "postgresql",
      folderId: "f-PostgreSQL",
      folderName: "PostgreSQL",
      dashboards: [
        {
          key: "overview",
          title: "PostgreSQL / Overview",
          dashboardId: "d1",
          folderId: "f-PostgreSQL",
          folderName: "PostgreSQL",
          created: true,
        },
      ],
    });
    expect(settingsSvc.setUserSetting.mock.calls[0][3].sources.postgresql.state).toBe("added");
  });

  it("reuses an existing same-name folder", async () => {
    folders.set("Redis", { folderId: "mine", name: "Redis" });
    const result = await installReadyMade(ORG, "redis");
    expect(svc.new_Folder).not.toHaveBeenCalled();
    expect(svc.create.mock.calls[0][2]).toBe("mine");
    expect(result.status).toBe("created");
  });

  it("re-reads the folder by name when its create loses a race", async () => {
    svc.new_Folder.mockImplementationOnce(async () => {
      folders.set("MySQL", { folderId: "raced", name: "MySQL" });
      throw Object.assign(new Error("exists"), { response: { status: 409 } });
    });
    const result = await installReadyMade(ORG, "mysql");
    expect(svc.get_Folder_By_Name).toHaveBeenCalledTimes(2);
    expect(svc.create.mock.calls[0][2]).toBe("raced");
    expect(result.status).toBe("created");
  });

  it("never creates when a marked copy exists anywhere in the org", async () => {
    seedCopy({ folder_id: "moved", folder_name: "DB team" });
    const result = await installReadyMade(ORG, "postgresql", { userId: "me@x.io" });
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.new_Folder).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "exists",
      folderId: "moved",
      folderName: "DB team",
      dashboards: [{ dashboardId: "seed-0", created: false }],
    });
    // Exists still means the user has it, so it stops being offered.
    expect(settingsSvc.setUserSetting.mock.calls[0][3].sources.postgresql.state).toBe("added");
  });

  it("ignores same-title dashboards without the marker", async () => {
    seedCopy({ role: "" });
    const result = await installReadyMade(ORG, "postgresql");
    expect(svc.create).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("created");
  });

  it("keeps the oldest copy after a create race and deletes only its own fresh copy", async () => {
    svc.create.mockImplementationOnce(async (_org: string, doc: any, folderId: string) => {
      // A teammate's copy landed first (older), then ours.
      seedCopy({ dashboard_id: "teammate", created: "2026-10-12T09:00:00Z" });
      rows.push({
        dashboard_id: "ours",
        folder_id: folderId,
        folder_name: "PostgreSQL",
        title: doc.title,
        role: doc.role,
        created: "2026-10-12T09:00:05Z",
      });
      return { data: { version: 8, v8: { dashboardId: "ours" } } };
    });
    const result = await installReadyMade(ORG, "postgresql");
    expect(svc.delete).toHaveBeenCalledTimes(1);
    expect(svc.delete).toHaveBeenCalledWith(ORG, "ours", "f-PostgreSQL", {
      silentForbidden: true,
    });
    // The survivor is the teammate's, so this call added nothing a toast could name.
    expect(result).toMatchObject({
      status: "exists",
      dashboards: [{ dashboardId: "teammate", created: false }],
    });
  });

  it("breaks a created-time tie on the id, and never deletes a copy it did not create", async () => {
    svc.create.mockImplementationOnce(async (_org: string, doc: any, folderId: string) => {
      seedCopy({ dashboard_id: "zzz", created: "2026-10-12T09:00:00Z" });
      rows.push({
        dashboard_id: "aaa",
        folder_id: folderId,
        folder_name: "PostgreSQL",
        title: doc.title,
        role: doc.role,
        created: "2026-10-12T09:00:00Z",
      });
      return { data: { version: 8, v8: { dashboardId: "aaa" } } };
    });
    const result = await installReadyMade(ORG, "postgresql");
    expect(svc.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dashboards: [{ dashboardId: "aaa" }] });
  });

  it("marks which dashboards this call created, so a re-add of a deleted one can name it", async () => {
    folders.set("Kubernetes", { folderId: "f-Kubernetes", name: "Kubernetes" });
    for (const [key, title] of [
      ["cluster", "Kubernetes / Cluster"],
      ["pod", "Kubernetes / Pod"],
      ["workload", "Kubernetes / Workload"],
    ]) {
      seedCopy({
        dashboard_id: `k8s-${key}`,
        folder_id: "f-Kubernetes",
        folder_name: "Kubernetes",
        title,
        role: `ready-made:kubernetes/${key}:1`,
      });
    }
    const result = await installReadyMade(ORG, "kubernetes");
    expect(svc.create.mock.calls.map((call) => call[1].title)).toEqual(["Kubernetes / Node"]);
    expect(result.status).toBe("created");
    if (result.status === "error") return;
    expect(result.dashboards.map((d) => [d.title, d.created])).toEqual([
      ["Kubernetes / Cluster", false],
      ["Kubernetes / Node", true],
      ["Kubernetes / Pod", false],
      ["Kubernetes / Workload", false],
    ]);
  });

  it("reports a 403 on create as forbidden, sent with silentForbidden", async () => {
    svc.create.mockRejectedValue(forbidden());
    const result = await installReadyMade(ORG, "redis", { userId: "me@x.io" });
    expect(result).toMatchObject({ status: "error", kind: "forbidden" });
    expect(svc.create.mock.calls[0][3]).toEqual({ silentForbidden: true });
    expect(settingsSvc.setUserSetting).not.toHaveBeenCalled();
  });

  it("reports a 403 on the folder create as forbidden", async () => {
    svc.new_Folder.mockRejectedValue(forbidden());
    const result = await installReadyMade(ORG, "redis");
    expect(result).toMatchObject({ status: "error", kind: "forbidden" });
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("a partial Kubernetes failure keeps what was created, and a retry adds only the rest", async () => {
    svc.create.mockImplementation(async (_org: string, doc: any, folderId: string) => {
      if (doc.title === "Kubernetes / Pod") throw new Error("boom");
      const id = `k${nextId++}`;
      clock += 1000;
      rows.push({
        dashboard_id: id,
        folder_id: folderId,
        folder_name: "Kubernetes",
        title: doc.title,
        role: doc.role,
        created: new Date(clock).toISOString(),
      });
      return { data: { version: 8, v8: { dashboardId: id } } };
    });
    const first = await installReadyMade(ORG, "kubernetes", { userId: "me@x.io" });
    expect(first).toMatchObject({ status: "error", kind: "generic" });
    expect(rows.map((row) => row.title)).toEqual(["Kubernetes / Cluster", "Kubernetes / Node"]);
    // A generic failure saves nothing.
    expect(settingsSvc.setUserSetting).not.toHaveBeenCalled();

    svc.create.mockClear();
    installBackendCreateOnly();
    const second = await installReadyMade(ORG, "kubernetes");
    expect(svc.create.mock.calls.map((call) => call[1].title)).toEqual([
      "Kubernetes / Pod",
      "Kubernetes / Workload",
    ]);
    expect(second.status).toBe("created");
    if (second.status !== "error") {
      expect(second.dashboards.map((d) => d.title)).toEqual([
        "Kubernetes / Cluster",
        "Kubernetes / Node",
        "Kubernetes / Pod",
        "Kubernetes / Workload",
      ]);
    }
  });

  it("invalidates the dashboard and folder caches after creating", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await installReadyMade(ORG, "postgresql");
    const keys = spy.mock.calls.map((call) => (call[0] as any)?.queryKey);
    expect(keys).toContainEqual(dashboardKeys.all(ORG));
    expect(keys).toContainEqual(folderKeys.all(ORG));
    spy.mockRestore();
  });

  it("does not invalidate the dashboard lists when nothing was created", async () => {
    seedCopy({});
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await installReadyMade(ORG, "postgresql");
    const keys = spy.mock.calls.map((call) => (call[0] as any)?.queryKey);
    expect(keys).not.toContainEqual(dashboardKeys.all(ORG));
    spy.mockRestore();
  });

  it("dedupes concurrent installs of the same source", async () => {
    const [a, b] = await Promise.all([
      installReadyMade(ORG, "redis"),
      installReadyMade(ORG, "redis"),
    ]);
    expect(svc.create).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

/** Restores the default create after a test replaced it. */
function installBackendCreateOnly() {
  svc.create.mockImplementation(async (_org: string, doc: any, folderId: string) => {
    const id = `d${nextId++}`;
    clock += 1000;
    rows.push({
      dashboard_id: id,
      folder_id: folderId,
      folder_name: "Kubernetes",
      title: doc.title,
      role: doc.role,
      created: new Date(clock).toISOString(),
    });
    return { data: { version: 8, v8: { dashboardId: id } } };
  });
}
