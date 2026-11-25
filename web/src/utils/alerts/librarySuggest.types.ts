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

// `GET /api/{org_id}/alerts/library/suggestions` (B-2). Contract: o2-polish run
// alert-form-2026-11-18 consolidated/contracts.md; design: phase2-stream-first-templates.md §2.2-2.5.

import type { LibrarySeverity } from "@/constants/alertLibrary";
import type { EvaluateAlertBody } from "./alertEvaluate.types";

export interface LibrarySuggestQuery {
  stream_type: "logs" | "metrics" | "traces";
  stream_name: string;
  alert_type?: "scheduled" | "anomaly_detection";
  /** Library matches returned; default 4, max 50. */
  limit?: number;
}

export type LibraryState = "ready" | "unavailable" | "unsupported_format";

export type SuggestionKind = "library" | "starter";

export type SuggestionFit = "fits" | "likely";

export type StarterShape = "rare_value" | "more_than_usual" | "percentile" | "per_group";

export interface AlreadySetUp {
  alert_id: string;
  name: string;
}

export interface StarterSlot {
  name: "category" | "value" | "measure" | "group";
  data_type: "string" | "number";
  /** Schema fields of that type, ranked by the server from the schema alone. */
  candidates: string[];
  /** RFC 6901 pointer into `prefill` where the chosen field or value goes. */
  pointer: string;
}

/** A create payload to prefill the form with; name, destinations and folder are never set. */
export type SuggestionPrefill = Partial<EvaluateAlertBody>;

export interface LibrarySuggestion {
  kind: SuggestionKind;
  /** Library: manifest `<pack>/<name>`. Starter: `starter:<shape>`. */
  id: string;
  /** Library: the manifest title as published. Starter: null, worded by the web from its shape. */
  title: string | null;
  /** Library: the manifest description. Starter: null. */
  sentence: string | null;
  severity: LibrarySeverity | null;
  alert_type: "scheduled" | "anomaly_detection";
  query_type: "promql" | "sql" | "custom";
  fit: SuggestionFit;
  matched_fields: string[];
  missing: string[];
  stream_swap: { written_for: string; will_use: string } | null;
  /** Empty when the org runs none on this stream. */
  already_set_up: AlreadySetUp[];
  enterprise: boolean;
  library: {
    pack: string;
    path: string;
    content_hash: string;
    docs_url: string | null;
  } | null;
  starter: { shape: StarterShape; slots: StarterSlot[] } | null;
  prefill: SuggestionPrefill;
}

export interface LibrarySuggestResponse {
  library: LibraryState;
  /** The manifest ETag the index was built from. */
  library_version: string | null;
  stream: { type: "logs" | "metrics" | "traces"; name: string; schema_read: boolean };
  counts: {
    fits: number;
    likely: number;
    already_set_up: number;
    starters: number;
    total: number;
  };
  /** Library matches first (at most `limit`), then every starter whose slots fill. */
  suggestions: LibrarySuggestion[];
}
