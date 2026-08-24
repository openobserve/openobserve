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

// Shape of the alert library manifest served from S3. Mirrors what
// `scripts/generate_manifest.py` in o2-alerts-library emits — that generator is
// the authority, and it fails its build rather than emit a partial entry.

import type { LibrarySeverity } from "@/constants/alertLibrary";

/** One installable alert, as indexed by the manifest. */
export interface AlertLibraryEntry {
  /** `<pack>/<name>` — stable key, stamped on install for provenance. */
  id: string;
  /** Filename stem; unique per pack, not globally. */
  name: string;
  pack: string;
  category: string;
  title: string;
  severity: LibrarySeverity;
  description: string;
  /** Primary stream, for display. `required_streams` is what gates readiness. */
  stream: string;
  stream_type: string;
  query_type: "promql" | "sql";
  /** Every stream that must exist for this alert to be installable. */
  required_streams: string[];
  /** Repo-relative path; resolve with `alertFileUrl()`. */
  path: string;
  /** sha256 prefix of the alert file — drives "update available". */
  content_hash: string;

  // Added by the metadata backfill; absent until then.
  tags?: string[];
  tier?: number;
  version?: string;
  docs_url?: string;
}

export interface AlertLibraryCategory {
  id: string;
  alert_count: number;
}

export interface AlertLibraryPack {
  id: string;
  categories: AlertLibraryCategory[];
  alert_count: number;
}

export interface AlertLibraryManifest {
  /** Compatibility gate; see SUPPORTED_MANIFEST_MAJOR. */
  format_version: string;
  alert_count: number;
  packs: AlertLibraryPack[];
  alerts: AlertLibraryEntry[];
}

/**
 * A whole alert file, fetched on demand.
 *
 * Deliberately loose: this is a stored OpenObserve alert whose full shape is
 * owned by the alert API, and the library ships whatever that API produced.
 * Narrowing it here would mean re-declaring the alert model in a second place
 * and drifting from it.
 */
export type AlertLibraryFile = Record<string, unknown>;

/** Org stream names grouped by stream type, for readiness checks. */
/**
 * Stream name → microsecond epoch of its newest record (0 when it has never
 * ingested), grouped by stream type.
 *
 * A Set of names would answer "does this stream exist", which is not the same
 * question as "would an alert on it have anything to fire on".
 */
export type StreamsByType = Record<string, Map<string, number>>;

/**
 * How much use an alert's streams would be to it.
 *
 * `missing` — no such stream in this org.
 * `never`   — the stream exists and has never received a record.
 * `stale`   — it received data once, but nothing recently.
 * `fresh`   — receiving data.
 */
export type StreamDataState = "missing" | "never" | "stale" | "fresh";
