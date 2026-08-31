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

// Single source of truth for where the curated alert library is fetched from.
//
// Alerts are authored in github.com/openobserve/o2-alerts-library and mirrored
// byte-for-byte into the S3 prefix below by that repo's CI. The product NEVER
// fetches them from GitHub at runtime — the GitHub API rate-limits
// unauthenticated callers at 60 req/hr, which is what broke the dashboard
// gallery. GitHub is the authoring surface; S3 is the serving surface.
//
// Two GETs are the entire client surface: `manifest.json` renders the whole
// gallery, then one alert file per drawer-open or install. There is no
// ListObjects call — the manifest IS the index.
//
// Everything here is derived from ALERT_LIBRARY_S3_BASE. Naming the bucket at a
// call site is how the dashboard gallery ended up with two paths, one of them
// stale, months apart.

/** Public S3 origin serving the synchronized alert library. */
export const ALERT_LIBRARY_S3_BASE = "https://openobserve-datasources-bucket.s3.amazonaws.com";

/** Key prefix the library repo is mirrored under. */
export const ALERT_LIBRARY_S3_PREFIX = "alerts/";

/** The one index the gallery reads. */
export const ALERT_LIBRARY_MANIFEST_URL = `${ALERT_LIBRARY_S3_BASE}/${ALERT_LIBRARY_S3_PREFIX}manifest.json`;

/**
 * Manifest `format_version` major this client can read.
 *
 * Format evolution lives in the file, not the URL: S3 mirrors GitHub exactly,
 * so there is no `/v1/` path to select. A major bump means the shape changed
 * and this client must refuse it rather than render something mangled.
 */
export const SUPPORTED_MANIFEST_MAJOR = 1;

/**
 * Library severity -> the API's `priority` field.
 *
 * Settled 2026-08-20. The library speaks `critical|warning|info`; the product
 * enum is P1..P5; the display vocabulary is `critical|high|medium|low|info`.
 * "warning" exists nowhere downstream, so this table is the single translation
 * point — never inline these numbers at a call site.
 *
 * The values are INTEGERS: `priority` is stored as an id 1..=5, and sending the
 * string "P1" is a 400 that TypeScript will not catch. "P1" is a display label
 * only (rendered via the `severity` badge group's p1/p3/p4 aliases).
 */
export const SEVERITY_TO_PRIORITY = { critical: 1, warning: 3, info: 4 } as const;

export type LibrarySeverity = keyof typeof SEVERITY_TO_PRIORITY;

/**
 * Resolve a library severity to an install-time `priority`, or `null`.
 *
 * `null` — not a default — for anything unrecognised: `priority` is
 * `Option<AlertPriority>` and unset is a legitimate state, whereas guessing
 * would silently decide what pages someone at 3am.
 *
 * `Object.hasOwn` rather than a bare lookup: `severity` arrives inside a
 * fetched document, and `TABLE["constructor"]` would otherwise return a
 * function that never trips a `?? null`.
 */
export const priorityForSeverity = (severity: string): number | null =>
  typeof severity === "string" && Object.hasOwn(SEVERITY_TO_PRIORITY, severity)
    ? SEVERITY_TO_PRIORITY[severity as LibrarySeverity]
    : null;

/**
 * Absolute URL for one alert file, from a manifest entry's `path`.
 *
 * `path` is repo-relative (`packs/<pack>/alerts/<category>/<name>.json`) and
 * the repo is mirrored under `alerts/`, so the prefix is prepended here.
 *
 * The manifest is fetched content, so `path` is untrusted: traversal segments
 * and absolute URLs are rejected rather than allowed to redirect the client at
 * an arbitrary key or host.
 */
export const alertFileUrl = (path: string): string => {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("alertFileUrl: path must be a non-empty string");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new Error(`alertFileUrl: path must be relative, got "${path}"`);
  }

  // Drop a leading slash so the caller cannot produce a doubled separator, then
  // drop empty interior segments for the same reason ("a//b" is a different S3
  // key from "a/b" and 404s).
  const segments = path.split("/").filter((segment) => segment !== "");

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`alertFileUrl: path must not traverse, got "${path}"`);
  }

  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${ALERT_LIBRARY_S3_BASE}/${ALERT_LIBRARY_S3_PREFIX}${encoded}`;
};
