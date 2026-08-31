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

// Where release notes come from, and the one local document standing in for
// them until the pipeline exists.
//
// PLANNED SERVING PATH — `whats-new/<version>.json` is authored in this repo
// alongside the version bump, CI folds every file into one `manifest.json` and
// mirrors it plus its media to the S3 prefix below. The product NEVER reads the
// GitHub API at runtime: unauthenticated callers are capped at 60 req/hr, which
// is what broke the dashboard gallery. GitHub authors, S3 serves — the same
// split the alert library settled on (see constants/alertLibrary.ts).
//
// Until that pipeline lands, `LOCAL_MANIFEST` below IS the manifest, so the
// surfaces can be reviewed against real layout instead of a mock. Deleting this
// constant and pointing the composable at the fetch is the whole migration.

import type { WireManifest } from "@/types/whatsNew";
import { getImageURL } from "@/utils/queryUtils";

/** Public S3 origin that will serve the manifest and its media. */
export const WHATS_NEW_S3_BASE = "https://openobserve-datasources-bucket.s3.amazonaws.com";

/** Key prefix the release-notes repo folder is mirrored under. */
export const WHATS_NEW_S3_PREFIX = "whats-new/";

/** The one index the carousel reads. */
export const WHATS_NEW_MANIFEST_URL = `${WHATS_NEW_S3_BASE}/${WHATS_NEW_S3_PREFIX}manifest.json`;

/**
 * Manifest `format_version` major this client can read.
 *
 * A major bump means the shape changed and this client must refuse it rather
 * than render something mangled.
 */
export const SUPPORTED_FORMAT_VERSION = 1;

/** Last version whose notes the user acknowledged. */
export const WHATS_NEW_SEEN_KEY = "o2_whats_new_seen";

/** Version the user asked not to be nagged about again. */
export const UPDATE_SKIPPED_KEY = "o2_update_skipped_version";

/** Highlights past this are dropped — beyond it, it stops being a highlight reel. */
export const MAX_HIGHLIGHTS = 6;

/**
 * Absolute URL for one media asset.
 *
 * Absolute inputs pass through, so a manifest fetched from S3 can name a full
 * URL. Anything relative resolves against the bundled assets, which is what the
 * local document below uses.
 */
export const resolveMediaUrl = (path: string): string =>
  /^https?:\/\//i.test(path) ? path : getImageURL(path);

/**
 * Stand-in release notes.
 *
 * Deliberately mixed: some highlights carry a screenshot and some do not, and
 * the editions differ per row — those are the two cases the layout has to
 * survive, so they belong in the sample rather than in a comment.
 */
export const LOCAL_MANIFEST: WireManifest = {
  format_version: 1,
  latest: "0.93.0",
  releases: [
    {
      version: "0.93.0",
      date: "2026-08-19",
      title: "SLOs, grouped alerts, and a curated alert library",
      summary:
        "Reliability targets become first-class, and alerting gets both a starting point and a volume control.",
      url: "https://openobserve.ai/whats-new/",
      highlights: [
        {
          id: "slo",
          title: "Service level objectives",
          body: [
            "Define a target, watch the error budget draw down, and get paged on **burn rate** before the budget is actually gone.",
            "",
            "- Availability and latency objectives over any stream",
            "- Multi-window burn-rate alerts, so a slow leak and a sudden outage page differently",
            "- Budget history on the SLO detail page, per rolling window",
            "",
            "Objectives live under `Alerts → SLOs`.",
          ].join("\n"),
          icon: "track-changes",
          editions: ["enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
          media: {
            light: "images/whats-new/sample-slo-light.svg",
            dark: "images/whats-new/sample-slo-dark.svg",
            alt: "Burn-rate chart with the error budget line and three summary tiles",
          },
        },
        {
          id: "grouped-alerts",
          title: "Grouped alerts",
          body: [
            "Related firings collapse into a single notification instead of paging you once per series.",
            "",
            "Pick the grouping keys yourself — group by `service` and `region` and a bad deploy in one region becomes **one** page rather than forty. Notification content lists every member, so nothing is lost in the collapse.",
          ].join("\n"),
          icon: "notifications-active",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
          media: {
            light: "images/whats-new/sample-alerts-light.svg",
            dark: "images/whats-new/sample-alerts-dark.svg",
            alt: "Alert list where each row shows how many firings it groups",
          },
        },
        {
          id: "alert-library",
          title: "Alert library",
          body: "Browse curated alerts by service, preview the query and thresholds, then install straight into a folder.",
          icon: "auto-awesome",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "terraform",
          title: "Terraform provider",
          body: [
            "Manage streams, alerts, dashboards, and folders as code, with full round-tripping so drift shows up in `terraform plan` instead of surprising you later.",
            "",
            "```hcl",
            'resource "openobserve_alert" "checkout_latency" {',
            '  name   = "checkout p95"',
            '  stream = "prod_logs"',
            "}",
            "```",
          ].join("\n"),
          icon: "code",
          editions: ["enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "folder-icons",
          title: "Folder icons",
          body: "Assign an icon and colour to any folder so a sidebar with forty dashboards stays scannable.",
          icon: "folder",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
      ],
    },
    {
      version: "0.92.0",
      date: "2026-08-07",
      title: "Synthetic monitoring and expanded AI observability",
      summary: "836 commits across both repositories. Two new product surfaces land at once.",
      url: "https://openobserve.ai/whats-new/",
      highlights: [
        {
          id: "synthetics",
          title: "Synthetic monitoring",
          body: "Browser and HTTP checks, run from managed regions or from private locations inside your own network.",
          icon: "monitor-heart",
          editions: ["enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "evals",
          title: "Trace and session evaluations",
          body: "Score LLM traffic against your own rubrics, on ingest or on a schedule, and track quality as a time series.",
          icon: "insights",
          editions: ["enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "service-graph",
          title: "Agent and service graph",
          body: "See how agents, tools, and services actually call each other, derived from trace topology rather than declared config.",
          icon: "hub",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "config-hardening",
          title: "Config endpoint hardening",
          body: "Deployment internals no longer reach the unauthenticated bootstrap response.",
          icon: "shield",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
      ],
    },
    {
      version: "0.91.0",
      date: "2026-06-23",
      title: "Redesigned UI and AI agent observability",
      summary: "A full visual rebuild, plus native MCP support for tracing agent behaviour.",
      url: "https://openobserve.ai/whats-new/2026-06-23-v0910-release/",
      highlights: [
        {
          id: "ui-rebuild",
          title: "Rebuilt interface",
          body: "New navigation, a consistent component library, and a dark theme that was designed rather than derived from the light one.",
          icon: "dashboard",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "mcp",
          title: "MCP protocol support",
          body: "Instrument agents over MCP and get a span for every tool call without writing custom wiring.",
          icon: "schema",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "query-perf",
          title: "Query performance",
          body: "Faster aggregation on high-cardinality fields across logs and traces.",
          icon: "speed",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
      ],
    },
    {
      version: "0.90.0",
      date: "2026-04-15",
      title: "Pipelines and enrichment tables",
      summary: "Transform and route at ingest, before anything reaches storage.",
      url: "https://openobserve.ai/whats-new/",
      highlights: [
        {
          id: "pipelines",
          title: "Ingest pipelines",
          body: "Parse, redact, and route incoming records with a visual builder.",
          icon: "bolt",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
        {
          id: "enrichment",
          title: "Enrichment tables",
          body: "Join reference data onto events at query time.",
          icon: "storage",
          editions: ["oss", "enterprise", "cloud"],
          docs_url: "https://openobserve.ai/docs/",
        },
      ],
    },
  ],
};
