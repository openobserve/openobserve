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
import { ref } from "vue";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { Entity, Resource } from "@/ts/interfaces";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import { useRoleGrants } from "@/composables/iam/useRoleGrants";
import { useRolePresets } from "@/composables/iam/useRolePresets";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { K8S_VIEWER_STREAMS } from "@/components/iam/roles/k8sViewerPreset";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

const ORG = "default";
const ALL = `_all_${ORG}`;
const PERMS = ["AllowAll", "AllowList", "AllowGet", "AllowDelete", "AllowPost", "AllowPut"];

const t = i18n.global.t as unknown as TranslateFn;

const MODULES = [
  "stream",
  "afolder",
  "destination",
  "template",
  "dfolder",
  "pipeline",
  "function",
  "enrichment_table",
  "db_monitoring",
  "sourcemaps",
  "rum_analytics",
  "settings",
];

// Mirrors useRolePermissionTree.modifyResourcePermissions for the resources in this fixture.
const HIDDEN: Record<string, string[]> = {
  settings: ["AllowList", "AllowDelete", "AllowPost"],
  rum_analytics: ["AllowList", "AllowGet"],
};

const node = (
  name: string,
  { type = "Type", resourceName = name, hidden = [] as string[] } = {},
): Resource =>
  ({
    name,
    resourceName,
    type,
    top_level: type === "Type",
    display_name: name,
    parent: "",
    childs: [],
    entities: [],
    permission: Object.fromEntries(
      PERMS.map((perm) => [perm, { show: !hidden.includes(perm), value: false }]),
    ),
  }) as unknown as Resource;

// Same key EditRole.permissionHashFor writes.
const permissionHashFor = (row: Resource | Entity, permission: string) => {
  let entity = row.type === "Type" ? ALL : row.name;
  let resourceName = row.resourceName;
  if (row.type === "Resource" && row.top_level) {
    resourceName = row.name;
    entity = ALL;
  }
  return `${resourceName}:${entity}:${permission}`;
};

const METRICS = ["cpu", "postgresql_backends", "mysql_threads", "system_cpu_time"];
const LOGS = ["app", "_rumdata", "_sessionreplay"];

function setup({
  modules = MODULES,
  saved = [] as string[],
  metrics = METRICS,
  logs = LOGS,
  failTypes = [] as string[],
} = {}) {
  const resources = modules.map((key) => node(key, { hidden: HIDDEN[key] }));
  const resourceMapper = ref<{ [key: string]: Resource }>(
    Object.fromEntries(resources.map((resource) => [resource.name, resource])),
  );
  const heavyResourceEntities = ref<{ [key: string]: Entity[] }>({});
  const grants = useRoleGrants();
  grants.seedSaved(saved);
  const lists: Record<string, string[]> = { metrics, logs };

  const handlePermissionBatchChange = vi.fn(
    (changes: { row: Resource | Entity; permission: string; newValue: boolean }[]) =>
      changes.forEach(({ row, permission }) => grants.toggle(permissionHashFor(row, permission))),
  );
  const getStreams = vi.fn(async (type: string) => {
    if (failTypes.includes(type)) throw new Error("403");
    return { list: lists[type] };
  });
  const getResourceEntities = vi.fn(async (resource: Resource | Entity) => {
    if (resource.entities?.length) return;
    if (resource.name === "stream") {
      resource.entities?.push(...["logs", "traces", "metrics", "index"].map((name) => node(name)));
    } else if (lists[resource.name]) {
      if (failTypes.includes(resource.name)) throw new Error("403");
      const rows = lists[resource.name].map(
        (name) =>
          node(name, {
            type: "Resource",
            resourceName: resource.name,
            hidden: ["AllowList", "AllowPost"],
          }) as unknown as Entity,
      );
      heavyResourceEntities.value[resource.name] = rows;
      resource.entities?.push(...rows);
    }
  });
  const expandPermission = vi.fn(async (resource: Resource | Entity) => {
    resource.expand = !resource.expand;
    if (resource.expand) await getResourceEntities(resource).catch(() => undefined);
  });

  const presets = useRolePresets({
    permissionsState: { permissions: resources },
    resourceMapper,
    heavyResourceEntities,
    grants,
    permissionHashFor,
    handlePermissionBatchChange,
    expandPermission,
    getResourceEntities,
    getStreams,
    t,
  });
  return { ...presets, grants, handlePermissionBatchChange, getResourceEntities, getStreams };
}

const added = (ctx: ReturnType<typeof setup>) => Object.keys(ctx.grants.added.value).sort();

const inRole = (preview: ReturnType<ReturnType<typeof setup>["previewPreset"]>) =>
  preview.status === "ready" && !preview.noMatchingStreams && preview.adds.length === 0;

beforeEach(() => mockToast.mockClear());

describe("useRolePresets - list", () => {
  it("lists the 5 built-ins then the 5 job presets", () => {
    const { presets } = setup();
    expect(presets.value.map((preset) => `${preset.section}:${preset.id}`)).toEqual([
      "builtin:readonly",
      "builtin:dbm",
      "builtin:k8s",
      "builtin:rum_viewer",
      "builtin:rum_editor",
      "job:alert_manager",
      "job:alert_viewer",
      "job:dashboard_editor",
      "job:dashboard_viewer",
      "job:pipeline_editor",
    ]);
  });

  it("gives every preset a title and description in en-US and a registered icon", () => {
    setup().presets.value.forEach((preset) => {
      expect(i18n.global.te(preset.titleKey, "en-us")).toBe(true);
      expect(i18n.global.te(preset.descriptionKey, "en-us")).toBe(true);
      expect(iconRegistry).toHaveProperty(preset.icon);
    });
  });

  it("hides a job preset when any module it grants is missing from this org", () => {
    const { presets } = setup({ modules: MODULES.filter((key) => key !== "template") });
    const ids = presets.value.map((preset) => preset.id);
    expect(ids).not.toContain("alert_manager");
    expect(ids).not.toContain("alert_viewer");
    expect(ids).toContain("dashboard_viewer");
  });
});

describe("useRolePresets - job presets", () => {
  it.each([
    [
      "alert_manager",
      [
        "afolder:ALL:AllowAll",
        "destination:ALL:AllowAll",
        "stream:ALL:AllowGet",
        "stream:ALL:AllowList",
        "template:ALL:AllowAll",
      ],
    ],
    [
      "alert_viewer",
      [
        "afolder:ALL:AllowGet",
        "afolder:ALL:AllowList",
        "destination:ALL:AllowGet",
        "destination:ALL:AllowList",
        "template:ALL:AllowGet",
        "template:ALL:AllowList",
      ],
    ],
    ["dashboard_editor", ["dfolder:ALL:AllowAll", "stream:ALL:AllowGet", "stream:ALL:AllowList"]],
    [
      "dashboard_viewer",
      [
        "dfolder:ALL:AllowGet",
        "dfolder:ALL:AllowList",
        "stream:ALL:AllowGet",
        "stream:ALL:AllowList",
      ],
    ],
    [
      "pipeline_editor",
      [
        "enrichment_table:ALL:AllowGet",
        "enrichment_table:ALL:AllowList",
        "function:ALL:AllowAll",
        "pipeline:ALL:AllowAll",
        "stream:ALL:AllowGet",
        "stream:ALL:AllowList",
      ],
    ],
  ])("%s stages exactly its module-wide grants", async (id, keys) => {
    const ctx = setup();
    const expected = keys.map((key) => key.replace("ALL", ALL));
    const preview = ctx.previewPreset(id);
    expect([...preview.adds].sort()).toEqual(expected);
    expect(preview.skipped).toBe(0);
    await ctx.applyPreset(id);
    expect(added(ctx)).toEqual(expected);
  });

  it("leaves nothing missing after any job preset", () => {
    const ctx = setup();
    [
      "alert_manager",
      "alert_viewer",
      "dashboard_editor",
      "dashboard_viewer",
      "pipeline_editor",
    ].forEach((id) => expect(ctx.previewPreset(id).stillMissing).toEqual([]));
  });

  it("still flags Streams for a manual Dashboard Folders grant the preset does not cover", () => {
    const ctx = setup({ saved: [`dfolder:${ALL}:AllowAll`] });
    expect(ctx.previewPreset("alert_viewer").stillMissing).toEqual([
      expect.objectContaining({ module: "stream", actions: ["AllowList", "AllowGet"] }),
    ]);
  });
});

describe("useRolePresets - preview", () => {
  it("stages nothing", () => {
    const ctx = setup();
    ctx.presets.value.forEach((preset) => ctx.previewPreset(preset.id));
    expect(ctx.handlePermissionBatchChange).not.toHaveBeenCalled();
    expect(added(ctx)).toEqual([]);
  });

  it("counts a grant the role already holds as skipped", () => {
    const ctx = setup({ saved: [`destination:${ALL}:AllowAll`] });
    const preview = ctx.previewPreset("alert_manager");
    expect(preview.adds).not.toContain(`destination:${ALL}:AllowAll`);
    expect(preview.adds).toHaveLength(4);
    expect(preview.skipped).toBe(1);
  });

  it("counts a grant staged but not saved as held", () => {
    const ctx = setup();
    ctx.grants.toggle(`dfolder:${ALL}:AllowAll`);
    expect(ctx.previewPreset("dashboard_editor").adds).toEqual([
      `stream:${ALL}:AllowList`,
      `stream:${ALL}:AllowGet`,
    ]);
  });

  it("skips List and Get on a module the role holds All on, and reads In Role", () => {
    const ctx = setup({ saved: [`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowAll`] });
    const preview = ctx.previewPreset("dashboard_viewer");
    expect(preview).toEqual({
      status: "ready",
      adds: [],
      restores: [],
      skipped: 4,
      readsEveryStream: false,
      stillMissing: [],
    });
    expect(inRole(preview)).toBe(true);
  });

  it("flags a preset that adds the stream wildcard Get, and only then", () => {
    const ctx = setup();
    expect(ctx.previewPreset("alert_manager").readsEveryStream).toBe(true);
    expect(ctx.previewPreset("alert_viewer").readsEveryStream).toBe(false);
  });

  it("does not flag a role that already holds the stream wildcard Get", () => {
    const ctx = setup({ saved: [`stream:${ALL}:AllowGet`, `stream:${ALL}:AllowList`] });
    expect(ctx.previewPreset("alert_manager").readsEveryStream).toBe(false);
  });

  it("does not read In Role while one grant is still missing", () => {
    const ctx = setup({ saved: [`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowList`] });
    const preview = ctx.previewPreset("dashboard_viewer");
    expect(preview.adds).toEqual([`stream:${ALL}:AllowGet`]);
    expect(inRole(preview)).toBe(false);
  });

  it("does not skip a module-wide grant because one item in the module is granted", () => {
    const ctx = setup({ saved: ["dfolder:Payments:AllowAll"] });
    expect(ctx.previewPreset("dashboard_viewer").adds).toContain(`dfolder:${ALL}:AllowList`);
  });

  it("adds a grant whose saved wider scope is staged for removal", () => {
    const ctx = setup({ saved: [`stream:${ALL}:AllowAll`] });
    expect(ctx.previewPreset("dashboard_viewer").adds).not.toContain(`stream:${ALL}:AllowList`);
    ctx.grants.toggle(`stream:${ALL}:AllowAll`);
    expect(ctx.previewPreset("dashboard_viewer").adds).toContain(`stream:${ALL}:AllowList`);
  });

  it("counts a saved grant staged for removal as an add, and Add restores it", async () => {
    const ctx = setup({ saved: [`afolder:${ALL}:AllowAll`] });
    ctx.grants.toggle(`afolder:${ALL}:AllowAll`);
    const preview = ctx.previewPreset("alert_manager");
    expect(preview.adds).toHaveLength(5);
    expect(preview.adds).toContain(`afolder:${ALL}:AllowAll`);
    expect(preview.restores).toEqual([`afolder:${ALL}:AllowAll`]);

    await ctx.applyPreset("alert_manager", { announce: true });

    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Alert Manager: 4 permissions added. Review Changes before you save.",
    });
    expect(ctx.grants.removed.value).toEqual({});
    expect(ctx.grants.has(`afolder:${ALL}:AllowAll`)).toBe(true);
    expect(added(ctx)).not.toContain(`afolder:${ALL}:AllowAll`);
  });
});

describe("useRolePresets - stream presets", () => {
  it("reports loading until the lists load, then ready", async () => {
    const ctx = setup();
    expect(ctx.previewPreset("k8s")).toEqual({
      status: "loading",
      adds: [],
      restores: [],
      skipped: 0,
      stillMissing: [],
    });
    await ctx.loadPresetStreams();
    const preview = ctx.previewPreset("k8s");
    expect(preview.status).toBe("ready");
    expect(preview.noMatchingStreams).toBe(false);
    expect(preview.adds).toEqual(["metrics:system_cpu_time:AllowGet", `metrics:${ALL}:AllowList`]);
  });

  it("loads the metrics and logs lists once, quietly", async () => {
    const ctx = setup();
    await Promise.all([ctx.loadPresetStreams(), ctx.loadPresetStreams()]);
    await ctx.loadPresetStreams();
    expect(ctx.getStreams.mock.calls).toEqual([
      ["metrics", false, false, false],
      ["logs", false, false, false],
    ]);
    expect(ctx.getResourceEntities.mock.calls.map(([resource]) => resource.name)).toEqual([
      "stream",
      "stream",
      "metrics",
      "logs",
    ]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("reads a list that matched no curated stream fresh on the next call, and finds streams ingested since", async () => {
    const metrics = ["cpu"];
    const ctx = setup({ metrics });
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("k8s").noMatchingStreams).toBe(true);

    metrics.push("system_cpu_time");
    await ctx.loadPresetStreams();

    expect(ctx.getStreams).toHaveBeenLastCalledWith("metrics", false, false, true);
    expect(ctx.previewPreset("k8s")).toMatchObject({
      status: "ready",
      noMatchingStreams: false,
      adds: ["metrics:system_cpu_time:AllowGet", `metrics:${ALL}:AllowList`],
    });
  });

  it("rebuilds the rows from the read that follows a failed refresh", async () => {
    const metrics = ["cpu"];
    const failTypes: string[] = [];
    const ctx = setup({ metrics, failTypes });
    await ctx.loadPresetStreams();

    metrics.push("postgresql_backends");
    failTypes.push("metrics");
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("dbm").status).toBe("failed");

    failTypes.pop();
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("dbm").adds).toContain("metrics:postgresql_backends:AllowGet");
  });

  it("reads a matched list fresh once it is older than the stream list cache", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const ctx = setup();
    await ctx.loadPresetStreams();
    await ctx.loadPresetStreams();
    expect(ctx.getStreams).toHaveBeenCalledTimes(2);

    now.mockReturnValue(MEDIUM_STALE_TIME);
    await ctx.loadPresetStreams();
    expect(ctx.getStreams.mock.calls.slice(2)).toEqual([
      ["metrics", false, false, true],
      ["logs", false, false, true],
    ]);
    now.mockRestore();
  });

  it("reports failed when a list does not load, and the next call retries only that list", async () => {
    const ctx = setup({ failTypes: ["metrics", "logs"] });
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("dbm").status).toBe("failed");
    await ctx.loadPresetStreams();
    expect(ctx.getStreams).toHaveBeenCalledTimes(4);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("keeps the metrics presets ready when only the logs list fails", async () => {
    const ctx = setup({ failTypes: ["logs"] });
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("k8s").status).toBe("ready");
    expect(ctx.previewPreset("dbm").status).toBe("ready");
    expect(ctx.previewPreset("rum_viewer").status).toBe("failed");
    expect(ctx.previewPreset("rum_editor").status).toBe("failed");

    await ctx.loadPresetStreams();
    expect(ctx.getStreams.mock.calls.map(([type]) => type)).toEqual(["metrics", "logs", "logs"]);
  });

  it("counts only curated streams that exist in this org", async () => {
    const ctx = setup();
    await ctx.loadPresetStreams();
    expect([...ctx.previewPreset("dbm").adds].sort()).toEqual([
      `db_monitoring:${ALL}:AllowGet`,
      `db_monitoring:${ALL}:AllowList`,
      `metrics:${ALL}:AllowList`,
      "metrics:mysql_threads:AllowGet",
      "metrics:postgresql_backends:AllowGet",
      "metrics:system_cpu_time:AllowGet",
    ]);
  });

  it("flags no matching streams and never reads In Role then", async () => {
    const ctx = setup({ metrics: ["cpu"], logs: ["app"] });
    await ctx.loadPresetStreams();
    const k8s = ctx.previewPreset("k8s");
    expect(k8s).toMatchObject({ status: "ready", adds: [], noMatchingStreams: true });
    expect(inRole(k8s)).toBe(false);
    expect(ctx.previewPreset("dbm").adds).toEqual([
      `db_monitoring:${ALL}:AllowList`,
      `db_monitoring:${ALL}:AllowGet`,
    ]);
  });

  it("skips a curated stream Get the role holds on its type, but still adds the type List", async () => {
    const ctx = setup({ saved: [`metrics:${ALL}:AllowGet`] });
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("k8s")).toMatchObject({
      adds: [`metrics:${ALL}:AllowList`],
      skipped: 1,
    });
  });

  it("skips the type List the role holds on every stream", async () => {
    const ctx = setup({ saved: [`stream:${ALL}:AllowList`] });
    await ctx.loadPresetStreams();
    expect(ctx.previewPreset("k8s").adds).toEqual(["metrics:system_cpu_time:AllowGet"]);
  });

  it("dbm stages the curated streams, the List-only metrics type node and db_monitoring", async () => {
    const ctx = setup();
    await ctx.applyPreset("dbm", { announce: true });
    expect(added(ctx)).toEqual([
      `db_monitoring:${ALL}:AllowGet`,
      `db_monitoring:${ALL}:AllowList`,
      `metrics:${ALL}:AllowList`,
      "metrics:mysql_threads:AllowGet",
      "metrics:postgresql_backends:AllowGet",
      "metrics:system_cpu_time:AllowGet",
    ]);
    expect(added(ctx)).not.toContain(`metrics:${ALL}:AllowGet`);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: t("iam.editRole.presetApplied", {
        title: t("iam.editRole.presetDbmTitle"),
        permissions: t("iam.editRole.presetPermissionCount", { count: 6 }, 6),
      }),
    });
  });

  it("k8s stages nothing and warns when no curated stream matches", async () => {
    const ctx = setup({ metrics: ["cpu"] });
    await ctx.applyPreset("k8s", { announce: true });
    expect(added(ctx)).toEqual([]);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "warning",
      message: t("iam.editRole.k8sPresetNoMatch", { total: K8S_VIEWER_STREAMS.length }),
    });
  });

  it("rum_viewer stages sourcemaps List and the RUM log streams; rum_editor adds the writes", async () => {
    const viewer = setup();
    await viewer.applyPreset("rum_viewer");
    expect(added(viewer)).toEqual([
      `logs:${ALL}:AllowList`,
      "logs:_rumdata:AllowGet",
      "logs:_sessionreplay:AllowGet",
      `sourcemaps:${ALL}:AllowList`,
    ]);

    const editor = setup();
    await editor.applyPreset("rum_editor");
    expect(added(editor)).toEqual([
      `logs:${ALL}:AllowList`,
      "logs:_rumdata:AllowGet",
      "logs:_sessionreplay:AllowGet",
      `rum_analytics:${ALL}:AllowDelete`,
      `rum_analytics:${ALL}:AllowPost`,
      `rum_analytics:${ALL}:AllowPut`,
      `sourcemaps:${ALL}:AllowList`,
    ]);
  });

  it("stages only what the preview counted when opening the type reloads more streams", async () => {
    const metrics: string[] = [];
    const ctx = setup({ metrics });
    await ctx.loadPresetStreams();
    const { adds } = ctx.previewPreset("dbm");
    expect([...adds].sort()).toEqual([
      `db_monitoring:${ALL}:AllowGet`,
      `db_monitoring:${ALL}:AllowList`,
    ]);

    metrics.push("postgresql_backends");
    await ctx.applyPreset("dbm", { announce: true });

    expect(added(ctx)).toEqual([...adds].sort());
  });

  it("readonly stages List and Get on every visible top-level resource, minus hidden actions", () => {
    const ctx = setup();
    ctx.seedReadonlyPreset();
    const keys = added(ctx);
    expect(keys).toContain(`settings:${ALL}:AllowGet`);
    expect(keys).not.toContain(`settings:${ALL}:AllowList`);
    expect(keys.some((key) => key.startsWith("rum_analytics:"))).toBe(false);
    expect(keys).toHaveLength(MODULES.length * 2 - 3);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("useRolePresets - apply", () => {
  it("stages exactly the previewed adds in one batch", async () => {
    const ctx = setup({ saved: [`stream:${ALL}:AllowList`] });
    const { adds } = ctx.previewPreset("pipeline_editor");
    await ctx.applyPreset("pipeline_editor");
    expect(ctx.handlePermissionBatchChange).toHaveBeenCalledTimes(1);
    expect(added(ctx)).toEqual([...adds].sort());
  });

  it("never toggles a held grant off, even when applied twice", async () => {
    const ctx = setup({ saved: [`afolder:${ALL}:AllowAll`] });
    await ctx.applyPreset("alert_manager");
    await ctx.applyPreset("alert_manager");
    await ctx.applyPreset("readonly");
    await ctx.applyPreset("readonly");
    expect(ctx.grants.removed.value).toEqual({});
    expect(ctx.grants.has(`afolder:${ALL}:AllowAll`)).toBe(true);
    expect(added(ctx)).toContain(`template:${ALL}:AllowAll`);
  });

  it("ignores a second apply while the first is in flight", async () => {
    const ctx = setup();
    const first = ctx.applyPreset("k8s");
    expect(ctx.applyingPreset.value).toBe(true);
    const second = ctx.applyPreset("alert_manager", { announce: true });
    ctx.seedReadonlyPreset();
    await Promise.all([first, second]);

    expect(ctx.applyingPreset.value).toBe(false);
    expect(added(ctx)).toEqual([`metrics:${ALL}:AllowList`, "metrics:system_cpu_time:AllowGet"]);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("toasts the staged count when announced", async () => {
    const ctx = setup();
    await ctx.applyPreset("alert_manager", { announce: true });
    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Alert Manager: 5 permissions added. Review Changes before you save.",
    });
  });

  it("uses the singular for one permission", async () => {
    const ctx = setup({ saved: [`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowList`] });
    await ctx.applyPreset("dashboard_editor", { announce: true });
    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Dashboard Editor: 1 permission added. Review Changes before you save.",
    });
  });

  it("says restored, not added, when the preset only undoes staged removals", async () => {
    const saved = [`dfolder:${ALL}:AllowAll`, `stream:${ALL}:AllowList`, `stream:${ALL}:AllowGet`];
    const ctx = setup({ saved });
    saved.forEach((key) => ctx.grants.toggle(key));
    await ctx.applyPreset("dashboard_editor", { announce: true });
    expect(ctx.grants.removed.value).toEqual({});
    expect(added(ctx)).toEqual([]);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Dashboard Editor: 3 permissions restored. Review Changes before you save.",
    });
  });

  it("does not toast without announce, or when nothing was staged", async () => {
    const ctx = setup();
    await ctx.applyPreset("readonly");
    await ctx.applyPreset("readonly", { announce: true });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("stages nothing and does not toast for an unknown id", async () => {
    const ctx = setup();
    await ctx.applyPreset("nope", { announce: true });
    expect(added(ctx)).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });
});
