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
import axios from "axios";

export type RejectionReason =
  "invalid_credentials" | "malformed_body" | "batch_too_large" | "rate_or_quota";

/** Mirrors common::meta::ingest_rejections::IngestRejection; `firstSeen` is Unix microseconds. */
export interface IngestRejection {
  firstSeen: number;
  status: number;
  reason: RejectionReason;
  path: string;
  tokenName?: string;
}

/** `tracked` is false for an org that already has user data, which never records rejections. */
export interface RecentRejections {
  tracked: boolean;
  list: IngestRejection[];
}

/** The wire entry; the server's serde names may be snake_case or camelCase. */
interface RawRejection {
  first_seen?: number;
  firstSeen?: number;
  status: number;
  reason: RejectionReason;
  path: string;
  token_name?: string;
  tokenName?: string;
}

const toRejection = (r: RawRejection): IngestRejection => {
  const tokenName = r.token_name ?? r.tokenName;
  return {
    firstSeen: Number(r.first_seen ?? r.firstSeen ?? 0),
    status: r.status,
    reason: r.reason,
    path: r.path,
    ...(tokenName ? { tokenName } : {}),
  };
};

/** Newest first-seen first; an older server that omits `tracked` is read as tracked. */
export const toRecentRejections = (
  data: { tracked?: boolean; list?: RawRejection[] } | undefined,
): RecentRejections => ({
  tracked: data?.tracked !== false,
  list: (data?.list ?? []).map(toRejection).sort((a, b) => b.firstSeen - a.firstSeen),
});

const ingestion = {
  // Not the shared http(): its 403 grouper toasts, and a failed read must stay silent.
  recentRejections: (org: string, apiEndpoint: string) =>
    axios.create({ baseURL: apiEndpoint, withCredentials: true }).get<{
      tracked?: boolean;
      list?: RawRejection[];
    }>(`/api/${encodeURIComponent(org)}/ingest/recent_rejections`),
};

export default ingestion;
