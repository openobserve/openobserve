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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import raw from "@/test/unit/fixtures/starterPacksCatalog.json";
import i18n from "@/locales";
import en from "@/locales/languages/en-US.json";
import { S3_BASE, S3_PREFIX } from "@/composables/useDashboardGallery";
import { HOST_METRICS_DASHBOARD_TITLE } from "@/composables/useHostMetricsDashboard";

import bundledKubernetesAlerts from "./bundledKubernetesAlerts.json";
import type { StarterPack } from "./types";
import {
  catalogVersion,
  packById,
  packs,
  packTitle,
  setPackCatalog,
  toStarterPack,
} from "./usePackCatalog";

const service = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock("@/services/starter_packs", () => ({ default: service }));

const catalog = raw as any;
setPackCatalog(catalog);
const rawPack = (id: string) => catalog.packs.find((pack: { id: string }) => pack.id === id);
const lookup = (key: string) =>
  key.split(".").reduce<any>((node, part) => (node == null ? node : node[part]), en);

const textKeys = (pack: StarterPack): string[] => [
  pack.titleKey,
  ...(pack.roles ?? []).map(({ titleKey }) => titleKey),
  ...(pack.flavours ?? []).map(({ titleKey }) => titleKey),
  ...Object.values(pack.aliasTitles ?? {}),
];

const answer = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body }));

// Today's Kubernetes and Hosts packs, so existing install records keep their pack and item ids.
const kubernetesToday = {
  id: "kubernetes",
  titleKey: "starterPacks.packs.kubernetes.title",
  folder: { name: "Kubernetes", description: "Installed by the Kubernetes starter pack" },
  nativeView: { feature: "kubernetes_monitoring", route: "infraKubernetes" },
  clusterScoped: true,
  collectorRoute: "ingestFromKubernetes",
  logo: "images/common/kubernetes.svg",
  version: "1.1.0",
  aliases: [
    ["k8s_cluster", "k8s_cluster_name", "cluster", "cluster_name"],
    [
      "k8s_namespace_name",
      "k8s_namespace",
      "namespace",
      "body_k8s_namespace_name",
      "body_namespace",
    ],
    ["k8s_pod_name", "k8s_pod", "pod", "body_k8s_pod_name", "body_pod"],
    ["k8s_node_name", "k8s_node", "node", "body_k8s_node_name", "body_node"],
    [
      "k8s_container_name",
      "k8s_container",
      "container",
      "body_k8s_container_name",
      "body_container",
    ],
    ["kind", "body_kind"],
    ["reason", "body_reason"],
    ["message", "body_message", "body_note"],
  ],
  aliasTitles: {
    k8s_cluster: "starterPacks.packs.kubernetes.fields.k8s_cluster",
    k8s_namespace_name: "starterPacks.packs.kubernetes.fields.k8s_namespace_name",
    k8s_pod_name: "starterPacks.packs.kubernetes.fields.k8s_pod_name",
    k8s_node_name: "starterPacks.packs.kubernetes.fields.k8s_node_name",
    k8s_container_name: "starterPacks.packs.kubernetes.fields.k8s_container_name",
    kind: "starterPacks.packs.kubernetes.fields.kind",
    reason: "starterPacks.packs.kubernetes.fields.reason",
    message: "starterPacks.packs.kubernetes.fields.message",
  },
  roles: [
    {
      id: "events",
      titleKey: "starterPacks.packs.kubernetes.roles.events",
      stream: "k8s_events",
      fields: ["kind", "reason", "message", "k8s_namespace_name"],
      identity: [
        { field: "instrumentation_library_name", pattern: "k8sobjects|k8s_events|k8sevents" },
        { field: "service_name", pattern: "k8s[-_]?events" },
        { field: "container_image_name", pattern: "event-exporter" },
      ],
    },
  ],
  flavours: [
    {
      id: "opentelemetry",
      titleKey: "starterPacks.packs.kubernetes.flavours.opentelemetry",
      detect: ["k8s_pod_phase", "k8s_node_allocatable_cpu", "k8s_container_cpu_request"],
      alerts: rawPack("kubernetes").flavours[0].alerts,
    },
  ],
  savedViews: [
    {
      id: "events",
      name: "Kubernetes events",
      search: {
        meta: {},
        data: { stream: { streamType: "logs", selectedStream: ["k8s_events"] }, query: "" },
      },
    },
  ],
};

const hostsToday = {
  id: "hosts",
  version: "1.1.0",
  titleKey: "starterPacks.packs.hosts.title",
  folder: { name: "Hosts", description: "Installed by the Hosts starter pack" },
  savedViews: [],
  collectorRoute: "ingestFromLinux",
  logo: "images/common/linux.svg",
  signals: [
    ["system_cpu_time", "node_cpu_seconds_total"],
    ["system_memory_usage", "node_memory_MemAvailable_bytes"],
    ["system_filesystem_usage", "node_filesystem_avail_bytes"],
  ],
};

describe("usePackCatalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("the shipped catalog file", () => {
    it("is format 1 with a mock catalog version", () => {
      expect(catalog.format_version.split(".")[0]).toBe("1");
      expect(catalog.catalog_version).toMatch(/^mock-/);
      expect(catalogVersion()).toBe(catalog.catalog_version);
    });

    it("holds nine packs with unique plain ids", () => {
      const ids = catalog.packs.map(({ id }: { id: string }) => id);
      expect(ids).toHaveLength(9);
      expect(new Set(ids).size).toBe(9);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    });

    it("gives every pack at least one dashboard and one alert", () => {
      for (const pack of catalog.packs) {
        expect(pack.dashboards.length, pack.id).toBeGreaterThan(0);
        expect(pack.alerts.core.length + pack.alerts.more.length, pack.id).toBeGreaterThan(0);
      }
    });

    it("names only code-map keys the app knows", () => {
      expect(packs().map(({ id }) => id)).toEqual(catalog.packs.map(({ id }: any) => id));
    });

    it("has en-US text for every key the nine packs read, resolved through vue-i18n", () => {
      for (const pack of packs()) {
        for (const key of textKeys(pack)) {
          expect(typeof lookup(key), key).toBe("string");
          expect(i18n.global.t(key), key).toBe(lookup(key));
        }
      }
    });
  });

  describe("toStarterPack", () => {
    it.each([
      ["bundled dashboard", { dashboards: [{ id: "d", title: "D", bundled: "nope" }] }],
      [
        "dashboard importer",
        { dashboards: [{ id: "d", title: "D", gallery_path: "d.json", importer: "nope" }] },
      ],
      ["bundled alert set", { bundled_alerts: "nope" }],
      ["detector", { detect: { detector: "nope" } }],
    ])("throws on an unknown %s", (name, change) => {
      expect(() => toStarterPack({ ...rawPack("traces"), ...change })).toThrow(
        `unknown starter pack ${name} "nope"`,
      );
    });

    it("throws on a dashboard with nothing to load", () => {
      const change = { dashboards: [{ id: "d", title: "D" }] };
      expect(() => toStarterPack({ ...rawPack("traces"), ...change })).toThrow();
    });

    it("maps the file's snake_case fields onto the pack", () => {
      const postgres = packById("postgresql")!;
      expect(postgres).toMatchObject({
        id: "postgresql",
        version: "1.0.0",
        collectorRoute: "postgres",
        logo: "images/ingestion/postgres.png",
        signals: [["postgresql_backends"], ["postgresql_commits"], ["postgresql_db_size"]],
        alerts: [
          "opentelemetry/postgresql_down_otel",
          "opentelemetry/postgresql_too_many_connections_otel",
          "opentelemetry/postgresql_low_cache_hit_rate_otel",
          "opentelemetry/postgresql_high_rollback_rate_otel",
          "opentelemetry/postgresql_replication_lag_otel",
        ],
        savedViews: [],
      });
      expect(postgres.dashboards.map(({ id, title }) => ({ id, title }))).toEqual([
        { id: "overview", title: "PostgreSQL" },
      ]);
      expect(packById("aws-cloudwatch")!.detectStreams).toEqual([
        { type: "logs", name: "cloudwatch_metrics" },
      ]);
      expect(packById("genai")!.detectStreams).toEqual([
        { type: "traces", fields: ["gen_ai_operation_name"] },
      ]);
      expect(packById("kubernetes")!.detector).toBe("kubernetes");
      expect(packById("nope")).toBeUndefined();
    });

    it("maps the item and tile summaries onto the pack", () => {
      const pack = packById("kubernetes")!;
      expect(pack.dashboards[0].summary).toBe("Clusters, nodes, pods and workloads in one view");
      expect(pack.savedViews[0].summary).toBe("Every Kubernetes event in one searchable list");
      expect(pack.alertSummaries?.["k8s/node_high_memory_usage"]).toBe(
        "Node memory use at or above 80%",
      );
      expect(pack.tileSummaries).toEqual({
        dashboards: "Clusters, nodes, pods and workloads in one view",
        alerts: "Crash loops, OOM kills, node memory and cluster capacity",
        savedViews: "Every Kubernetes event in one searchable list",
      });
      expect(packById("hosts")!.tileSummaries?.savedViews).toBeUndefined();
    });

    it("leaves the summaries out when the catalog has none", () => {
      const { alert_summaries: _alerts, tile_summaries: _tiles, ...bare } = rawPack("kubernetes");
      const pack = toStarterPack({
        ...bare,
        dashboards: bare.dashboards.map(({ summary: _s, ...rest }: any) => rest),
        saved_views: bare.saved_views.map(({ summary: _s, ...rest }: any) => rest),
      });
      expect(pack.dashboards[0].summary).toBeUndefined();
      expect(pack.savedViews[0].summary).toBeUndefined();
      expect(pack.alertSummaries).toBeUndefined();
      expect(pack.tileSummaries).toBeUndefined();
    });

    it("titles a pack from the app text, or from the catalog when the app has none", () => {
      expect(packTitle(packById("kubernetes")!)).toBe("Kubernetes");
      const redis = toStarterPack({ ...rawPack("hosts"), id: "redis", title: "Redis" });
      expect(redis.title).toBe("Redis");
      expect(packTitle(redis)).toBe("Redis");
    });

    it("keeps the Kubernetes pack as it was, with core and more alerts in one list", () => {
      const pack = packById("kubernetes")!;
      expect(pack).toMatchObject(kubernetesToday);
      expect(pack.bundledAlerts).toEqual(bundledKubernetesAlerts);
      expect(pack.signals).toBeUndefined();
      expect(pack.dashboards.map(({ id, title, shared }) => ({ id, title, shared }))).toEqual([
        { id: "overview", title: "Kubernetes Overview", shared: undefined },
      ]);
      const { core, more } = rawPack("kubernetes").alerts;
      expect(pack.alerts).toEqual([...core, ...more]);
    });

    it("keeps the Hosts pack as it was, its dashboard shared with the setup card", () => {
      const pack = packById("hosts")!;
      expect(pack).toMatchObject(hostsToday);
      expect(pack.dashboards.map(({ id, title }) => ({ id, title }))).toEqual([
        { id: "host_metrics", title: "Host Metrics" },
      ]);
      expect(pack.dashboards[0].title).toBe(HOST_METRICS_DASHBOARD_TITLE);
      expect(pack.dashboards[0].shared).toEqual({
        folderId: "default",
        find: expect.any(Function),
        create: expect.any(Function),
      });
    });
  });

  describe("dashboard loading", () => {
    it("reads the gallery copy with a timeout", async () => {
      const fetch = answer({ title: "From gallery", tabs: [] });
      vi.stubGlobal("fetch", fetch);
      const doc = await packById("traces")!.dashboards[0].load();
      expect(doc.title).toBe("From gallery");
      expect(fetch).toHaveBeenCalledWith(
        `${S3_BASE}/${S3_PREFIX}Traces_APM/Traces APM.dashboard.json`,
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it("falls back to the bundled copy when the gallery is out of reach or has no tabs", async () => {
      const load = packById("kubernetes")!.dashboards[0].load;
      vi.stubGlobal("fetch", answer({}, false));
      expect(Array.isArray((await load()).tabs)).toBe(true);
      vi.stubGlobal("fetch", answer({ title: "broken" }));
      expect((await load()).title).not.toBe("broken");
    });

    it("fails a dashboard with no bundled copy when the gallery is out of reach", async () => {
      vi.stubGlobal("fetch", answer({}, false));
      await expect(packById("traces")!.dashboards[0].load()).rejects.toThrow();
    });

    it("reads a bundled-only dashboard without the gallery", async () => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const doc = await packById("hosts")!.dashboards[0].load();
      expect(Array.isArray(doc.tabs)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("loading from the server", () => {
    // A fresh module per test, so each one starts with nothing loaded.
    const freshCatalog = async () => {
      vi.resetModules();
      return import("./usePackCatalog");
    };
    const served = { catalog_version: "2026.11.18", source: "remote", packs: catalog.packs };

    beforeEach(() => service.catalog.mockReset());

    it("reads nothing before the load and every pack after it", async () => {
      service.catalog.mockResolvedValue({ data: served });
      const fresh = await freshCatalog();
      expect(fresh.packCatalogState.value).toBe("idle");
      expect(fresh.packs()).toEqual([]);
      expect(fresh.packById("kubernetes")).toBeUndefined();
      expect(fresh.catalogVersion()).toBe("");

      expect(await fresh.loadPackCatalog("default")).toBe(true);
      expect(fresh.packCatalogState.value).toBe("ready");
      expect(fresh.packs().map(({ id }) => id)).toEqual(catalog.packs.map(({ id }: any) => id));
      expect(fresh.packById("kubernetes")?.id).toBe("kubernetes");
      expect(fresh.catalogVersion()).toBe("2026.11.18");
      expect(service.catalog).toHaveBeenCalledWith("default");
    });

    it("sends one request for concurrent and later loads of one org", async () => {
      let answerWith: (value: unknown) => void = () => {};
      service.catalog.mockReturnValue(new Promise((resolve) => (answerWith = resolve)));
      const fresh = await freshCatalog();
      const first = fresh.loadPackCatalog("default");
      const second = fresh.loadPackCatalog("default");
      expect(fresh.packCatalogState.value).toBe("loading");
      answerWith({ data: served });
      expect(await Promise.all([first, second])).toEqual([true, true]);
      expect(await fresh.loadPackCatalog("default")).toBe(true);
      expect(service.catalog).toHaveBeenCalledTimes(1);
    });

    it("reads the catalog again for another org", async () => {
      service.catalog.mockResolvedValueOnce({ data: served });
      service.catalog.mockResolvedValueOnce({
        data: { ...served, catalog_version: "other", packs: catalog.packs.slice(0, 1) },
      });
      const fresh = await freshCatalog();
      expect(await fresh.loadPackCatalog("default")).toBe(true);
      expect(await fresh.loadPackCatalog("other")).toBe(true);
      expect(service.catalog).toHaveBeenNthCalledWith(2, "other");
      expect(fresh.catalogVersion()).toBe("other");
      expect(fresh.packs()).toHaveLength(1);
    });

    it("keeps only the last org's catalog when an earlier org's answer lands late", async () => {
      let answerFirst: (value: unknown) => void = () => {};
      service.catalog.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
      service.catalog.mockResolvedValueOnce({
        data: { ...served, catalog_version: "other", packs: catalog.packs.slice(0, 1) },
      });
      const fresh = await freshCatalog();
      const first = fresh.loadPackCatalog("default");
      expect(await fresh.loadPackCatalog("other")).toBe(true);
      answerFirst({ data: served });
      await first;
      expect(fresh.catalogVersion()).toBe("other");
      expect(fresh.packCatalogState.value).toBe("ready");
    });

    it("leaves out a pack this build cannot build and keeps the rest", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const unknownMap = {
        ...rawPack("kubernetes"),
        id: "kubernetes",
        dashboards: [{ id: "x", title: "X", bundled: "redis_overview" }],
      };
      const noText = { ...rawPack("hosts"), id: "redis" };
      const noAlerts = { ...rawPack("hosts"), alerts: undefined };
      service.catalog.mockResolvedValue({
        data: { ...served, packs: [unknownMap, ...catalog.packs, noText, noAlerts] },
      });
      const fresh = await freshCatalog();
      expect(await fresh.loadPackCatalog("default")).toBe(true);
      expect(fresh.packCatalogState.value).toBe("ready");
      // A pack with no app text still builds, titled from the catalog.
      expect(fresh.packs().map(({ id }) => id)).toEqual([
        ...catalog.packs.map(({ id }: any) => id),
        "redis",
      ]);
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it("marks a catalog with no buildable pack unavailable and retries on the next call", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      service.catalog.mockResolvedValueOnce({
        data: { ...served, packs: [{ ...rawPack("hosts"), id: "redis", bundled_alerts: "nope" }] },
      });
      const fresh = await freshCatalog();
      expect(await fresh.loadPackCatalog("default")).toBe(false);
      expect(fresh.packCatalogState.value).toBe("error");
      expect(fresh.packs()).toEqual([]);

      service.catalog.mockResolvedValue({ data: served });
      expect(await fresh.loadPackCatalog("default")).toBe(true);
      expect(fresh.packs()).toHaveLength(9);
      warn.mockRestore();
    });

    it("marks a response with no pack list unavailable", async () => {
      service.catalog.mockResolvedValue({ data: { catalog_version: "v1" } });
      const fresh = await freshCatalog();
      expect(await fresh.loadPackCatalog("default")).toBe(false);
      expect(fresh.packCatalogState.value).toBe("error");
    });

    it("marks a refused load unavailable, keeps the readers empty and retries on the next call", async () => {
      service.catalog.mockRejectedValueOnce({ response: { status: 403 } });
      const fresh = await freshCatalog();
      expect(await fresh.loadPackCatalog("default")).toBe(false);
      expect(fresh.packCatalogState.value).toBe("error");
      expect(fresh.packs()).toEqual([]);
      await expect(fresh.ensurePackCatalog("default")).rejects.toThrow();

      service.catalog.mockResolvedValue({ data: served });
      expect(await fresh.loadPackCatalog("default")).toBe(true);
      expect(fresh.packs()).toHaveLength(9);
    });
  });
});
