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

import { afterEach, describe, expect, it, vi } from "vitest";

import raw from "@/assets/starterPacks/catalog.mock.json";
import i18n from "@/locales";
import en from "@/locales/languages/en-US.json";
import { S3_BASE, S3_PREFIX } from "@/composables/useDashboardGallery";
import { HOST_METRICS_DASHBOARD_TITLE } from "@/composables/useHostMetricsDashboard";

import bundledKubernetesAlerts from "./bundledKubernetesAlerts.json";
import type { StarterPack } from "./types";
import { catalogVersion, packById, packs, toStarterPack } from "./usePackCatalog";

const catalog = raw as any;
const rawPack = (id: string) => catalog.packs.find((pack: { id: string }) => pack.id === id);
const lookup = (key: string) =>
  key.split(".").reduce<any>((node, part) => (node == null ? node : node[part]), en);

const textKeys = (pack: StarterPack): string[] => [
  pack.titleKey,
  pack.descriptionKey,
  ...(pack.pausedImpactKey ? [pack.pausedImpactKey] : []),
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
  descriptionKey: "starterPacks.packs.kubernetes.description",
  folder: { name: "Kubernetes", description: "Installed by the Kubernetes starter pack" },
  nativeView: { feature: "kubernetes_monitoring", route: "infraKubernetes" },
  clusterScoped: true,
  collectorRoute: "ingestFromKubernetes",
  logo: "images/common/kubernetes.svg",
  pausedImpactKey: "starterPacks.packs.kubernetes.pausedImpact",
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
  descriptionKey: "starterPacks.packs.hosts.description",
  folder: { name: "Hosts", description: "Installed by the Hosts starter pack" },
  savedViews: [],
  collectorRoute: "ingestFromLinux",
  logo: "images/common/linux.svg",
  pausedImpactKey: "starterPacks.packs.hosts.pausedImpact",
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
});
