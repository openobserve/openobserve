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

// S3 dashboard-template gallery list/fetch/cache, extracted from
// AddDashboardFromGitHub.vue (design 4.3) so the drawer and the Dashboards
// empty state share ONE implementation and one Vuex cache.

import { ref } from "vue";
import { useStore } from "vuex";
import { gt, type I18nText } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

export interface GalleryDashboard {
  name: string;
  displayName: string;
  description?: I18nText;
  folderPath: string;
  jsonFiles: string[];
}

export const S3_BASE = "https://openobserve-datasources-bucket.s3.amazonaws.com";
export const S3_PREFIX = "dashboards/";

/** Preferred category order for grouping/ranking gallery cards. */
export const CATEGORY_ORDER = [
  "aws",
  "cloudwatch",
  "googleCloud",
  "azure",
  "kubernetes",
  "database",
  "networking",
  "observability",
  "security",
  "storage",
  "dashboard",
];

// Classify a dashboard into a category key, its icon, and a token-backed
// badge variant. Category keys resolve to translated labels at the call site.
export function getCategoryInfo(dashboard: { name: string }): {
  icon: string;
  variant: BadgeVariant;
  category: string;
} {
  const n = dashboard.name.toLowerCase();
  if (
    n.includes("aws") ||
    n.includes("amazon") ||
    n.includes("ec2") ||
    n.includes("s3") ||
    n.includes("rds") ||
    n.includes("elb") ||
    n.includes("lambda")
  )
    return { icon: "cloud", variant: "orange-soft", category: "aws" };
  if (n.includes("cloudwatch"))
    return { icon: "cloud", variant: "orange-soft", category: "cloudwatch" };
  if (n.includes("gcp") || n.includes("google") || n.includes("bigquery") || n.includes("pubsub"))
    return { icon: "cloud", variant: "blue-soft", category: "googleCloud" };
  if (n.includes("azure") || n.includes("microsoft"))
    return { icon: "cloud", variant: "cyan-soft", category: "azure" };
  if (
    n.includes("kubernetes") ||
    n.includes("k8s") ||
    n.includes("kube") ||
    n.includes("pod") ||
    n.includes("helm") ||
    n.includes("container") ||
    n.includes("docker")
  )
    return { icon: "hub", variant: "indigo-soft", category: "kubernetes" };
  if (
    n.includes("postgres") ||
    n.includes("mysql") ||
    n.includes("mongo") ||
    n.includes("redis") ||
    n.includes("elastic") ||
    n.includes("cassandra") ||
    n.includes("database") ||
    n.includes("db")
  )
    return { icon: "database", variant: "purple-soft", category: "database" };
  if (
    n.includes("nginx") ||
    n.includes("apache") ||
    n.includes("haproxy") ||
    n.includes("istio") ||
    n.includes("envoy") ||
    n.includes("traefik")
  )
    return { icon: "dns", variant: "teal-soft", category: "networking" };
  if (
    n.includes("security") ||
    n.includes("audit") ||
    n.includes("threat") ||
    n.includes("waf") ||
    n.includes("firewall")
  )
    return { icon: "shield", variant: "error-soft", category: "security" };
  if (
    n.includes("monitor") ||
    n.includes("alert") ||
    n.includes("metric") ||
    n.includes("prometheus") ||
    n.includes("opentelemetry") ||
    n.includes("otel")
  )
    return { icon: "monitor-heart", variant: "success-soft", category: "observability" };
  if (n.includes("storage") || n.includes("disk") || n.includes("blob"))
    return { icon: "storage", variant: "amber-soft", category: "storage" };
  return { icon: "dashboard", variant: "primary-soft", category: "dashboard" };
}

function parseS3Folders(xmlText: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const prefixes = Array.from(doc.querySelectorAll("CommonPrefixes Prefix"));
  return prefixes
    .map((el) => {
      const full = el.textContent || "";
      return full.replace(S3_PREFIX, "").replace(/\/$/, "");
    })
    .filter(Boolean);
}

export function parseS3Files(xmlText: string, folderPath: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const keys = Array.from(doc.querySelectorAll("Contents Key"));
  const prefix = `${S3_PREFIX}${folderPath}/`;
  return keys
    .map((el) => (el.textContent || "").replace(prefix, ""))
    .filter((name) => name.endsWith(".json") && !name.includes("/"));
}

export function useDashboardGallery() {
  const store = useStore();
  const loading = ref(false);
  const error = ref("");
  const dashboards = ref<GalleryDashboard[]>([]);

  // Never rejects — failures land in `error` for the caller's UI.
  const loadDashboards = async () => {
    loading.value = true;
    error.value = "";
    try {
      const cache = store.state.githubDashboardGallery;
      const cacheAge = cache.lastFetched ? Date.now() - cache.lastFetched : Infinity;
      if (cache.dashboards.length > 0 && cacheAge < cache.cacheExpiry) {
        dashboards.value = cache.dashboards;
        return;
      }

      // Folder list via the S3 List Objects v2 API (requires s3:ListBucket).
      const response = await fetch(`${S3_BASE}/?list-type=2&prefix=${S3_PREFIX}&delimiter=/`);
      if (!response.ok) {
        throw new Error(gt("dashboard.addDashboardFromGitHub.fetchDashboardsError"));
      }

      const xmlText = await response.text();
      const folderNames = parseS3Folders(xmlText).filter((name) => !name.startsWith("."));

      const dashboardList = folderNames
        .map((name) => ({
          name,
          displayName: name.replace(/_/g, " "),
          folderPath: name,
          jsonFiles: [],
        }))
        .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

      store.commit("setGithubDashboardGallery", dashboardList);
      dashboards.value = dashboardList;
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : gt("dashboard.addDashboardFromGitHub.loadGalleryError");
    } finally {
      loading.value = false;
    }
  };

  return { dashboards, loading, error, loadDashboards };
}
