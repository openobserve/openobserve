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

import catalogFile from "@/assets/starterPacks/catalog.mock.json";
import { S3_BASE, S3_PREFIX } from "@/composables/useDashboardGallery";
import {
  findHostMetricsDashboard,
  importHostMetricsDashboard,
} from "@/composables/useHostMetricsDashboard";
import type { I18nKey } from "@/types/i18n";

import bundledKubernetesAlerts from "./bundledKubernetesAlerts.json";
import type {
  PackBundledAlert,
  PackDashboard,
  PackDetectStream,
  PackFlavourAlert,
  PackIdentityRule,
  PackSavedView,
  PackSharedDashboard,
  StarterPack,
} from "./types";

interface RawDashboard {
  id: string;
  title: string;
  gallery_path?: string;
  bundled?: string;
  importer?: string;
}

interface RawPack {
  id: string;
  version: string;
  folder: { name: string; description: string };
  logo?: string;
  collector_route?: string;
  native_view?: { feature: string; route: string };
  cluster_scoped?: boolean;
  detect?: { metric_names?: string[][]; streams?: PackDetectStream[]; detector?: string };
  dashboards: RawDashboard[];
  alerts: { core: string[]; more: string[] };
  bundled_alerts?: string;
  aliases?: string[][];
  alias_titles?: Record<string, string>;
  roles?: Array<{ id: string; stream: string; fields: string[]; identity: PackIdentityRule[] }>;
  flavours?: Array<{ id: string; detect: string[]; alerts: Record<string, PackFlavourAlert> }>;
  saved_views?: PackSavedView[];
  paused_impact?: string;
}

interface RawCatalog {
  format_version: string;
  catalog_version: string;
  packs: RawPack[];
}

const GALLERY_TIMEOUT_MS = 10_000;

const BUNDLED_DASHBOARDS: Record<string, () => Promise<Record<string, any>>> = {
  kubernetes_overview: async () =>
    (await import("@/assets/dashboards/kubernetes_overview.dashboard.json")).default,
  host_metrics: async () =>
    (await import("@/assets/dashboards/host_metrics.dashboard.json")).default,
};

const failure = (result: { status: string; message?: string }) =>
  new Error(result.message ?? "host metrics dashboard import failed");

// The setup card imports the same dashboard, so both go through its one importer (R22).
const HOST_METRICS_IMPORT: PackSharedDashboard = {
  find: async (org) => {
    const result = await findHostMetricsDashboard(org);
    if (result.status === "error") throw failure(result);
    return result.status === "exists"
      ? { id: result.dashboardId, folderId: result.folderId }
      : null;
  },
  create: async (org) => {
    const result = await importHostMetricsDashboard(org);
    if (result.status === "error") throw failure(result);
    return result.status === "created";
  },
};

const IMPORTERS: Record<string, PackSharedDashboard> = { host_metrics: HOST_METRICS_IMPORT };

const BUNDLED_ALERTS: Record<string, PackBundledAlert[]> = {
  kubernetes: bundledKubernetesAlerts as PackBundledAlert[],
};

const DETECTORS: Record<string, NonNullable<StarterPack["detector"]>> = {
  kubernetes: "kubernetes",
};

let built: StarterPack[] | null = null;

const known = <T>(map: Record<string, T>, key: string, what: string): T => {
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    throw new Error(`unknown starter pack ${what} "${key}"`);
  }
  return map[key];
};

const readGallery = async (path: string): Promise<Record<string, any>> => {
  const response = await fetch(`${S3_BASE}/${S3_PREFIX}${path}`, {
    signal: AbortSignal.timeout(GALLERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`gallery answered ${response.status}`);
  const doc = await response.json();
  if (!Array.isArray(doc?.tabs)) throw new Error("gallery dashboard has no tabs");
  return doc;
};

// The gallery holds the full dashboard; a bundled copy keeps the pack working offline.
const dashboardLoader = (
  galleryPath: string | undefined,
  bundled: (() => Promise<Record<string, any>>) | undefined,
) => {
  if (!galleryPath && !bundled) throw new Error("starter pack dashboard has nothing to load");
  return async () => {
    if (!galleryPath) return bundled!();
    try {
      return await readGallery(galleryPath);
    } catch (error) {
      if (!bundled) throw error;
      return bundled();
    }
  };
};

const toDashboard = (raw: RawDashboard): PackDashboard => {
  const bundled = raw.bundled
    ? known(BUNDLED_DASHBOARDS, raw.bundled, "bundled dashboard")
    : undefined;
  return {
    id: raw.id,
    title: raw.title,
    load: dashboardLoader(raw.gallery_path, bundled),
    ...(raw.importer ? { shared: known(IMPORTERS, raw.importer, "dashboard importer") } : {}),
  };
};

const textKey = (id: string, path: string) => `starterPacks.packs.${id}.${path}` as I18nKey;

/** Maps one catalog entry onto the pack shape; an unknown code-map key throws. */
export const toStarterPack = (raw: RawPack): StarterPack => {
  const detector = raw.detect?.detector
    ? known(DETECTORS, raw.detect.detector, "detector")
    : undefined;
  const optional = {
    bundledAlerts: raw.bundled_alerts
      ? known(BUNDLED_ALERTS, raw.bundled_alerts, "bundled alert set")
      : undefined,
    aliases: raw.aliases,
    aliasTitles: raw.alias_titles
      ? Object.fromEntries(
          Object.keys(raw.alias_titles).map((field) => [field, textKey(raw.id, `fields.${field}`)]),
        )
      : undefined,
    roles: raw.roles?.map(({ id, stream, fields, identity }) => ({
      id,
      titleKey: textKey(raw.id, `roles.${id}`),
      stream,
      fields,
      identity,
    })),
    flavours: raw.flavours?.map(({ id, detect, alerts }) => ({
      id,
      titleKey: textKey(raw.id, `flavours.${id}`),
      detect,
      alerts,
    })),
    nativeView: raw.native_view,
    clusterScoped: raw.cluster_scoped,
    collectorRoute: raw.collector_route,
    signals: raw.detect?.metric_names,
    detectStreams: raw.detect?.streams,
    detector,
    logo: raw.logo,
    pausedImpactKey: raw.paused_impact ? textKey(raw.id, "pausedImpact") : undefined,
  };
  return {
    id: raw.id,
    version: raw.version,
    titleKey: textKey(raw.id, "title"),
    descriptionKey: textKey(raw.id, "description"),
    folder: raw.folder,
    dashboards: raw.dashboards.map(toDashboard),
    alerts: [...raw.alerts.core, ...raw.alerts.more],
    savedViews: raw.saved_views ?? [],
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
  };
};

/** Every starter pack, in catalog order; built once, since setup code reads it synchronously. */
export const packs = (): StarterPack[] => {
  built ??= (catalogFile as unknown as RawCatalog).packs.map(toStarterPack);
  return built;
};

export const packById = (id: string): StarterPack | undefined =>
  packs().find((pack) => pack.id === id);

/** Saved on an install record so a later catalog can tell what the install came from. */
export const catalogVersion = (): string => (catalogFile as unknown as RawCatalog).catalog_version;
