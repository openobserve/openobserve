// Copyright 2023 OpenObserve Inc.
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

import type { CrossLink } from "@/composables/useLogs/searchState";
import { isSafeNavigableUrl } from "@/utils/safeUrl";

// Stream types for which the cross-linking feature (and its `result_schema`
// API call) is supported. Cross-linking is only meaningful for logs streams;
// the `result_schema` endpoint errors for other stream types (metrics, traces,
// enrichment_tables), so the call must be skipped for them.
export const CROSS_LINKING_SUPPORTED_STREAM_TYPES = ["logs"] as const;

/** True when `result_schema` can be called for this stream type, whatever the cross-linking config. */
export const supportsResultSchema = (streamType: string | undefined): boolean =>
  (CROSS_LINKING_SUPPORTED_STREAM_TYPES as readonly string[]).includes(streamType ?? "");

/**
 * Returns true when cross-linking should be active for the given stream type.
 * Requires the `enable_cross_linking` config flag to be on AND the stream type
 * to be one of the supported types.
 */
export const isCrossLinkingEnabledForStream = (
  zoConfig: any,
  streamType: string | undefined,
): boolean => !!zoConfig?.enable_cross_linking && supportsResultSchema(streamType);

export interface CrossLinks {
  stream_links?: CrossLink[];
  org_links?: CrossLink[];
}

export interface CrossLinkContext {
  fieldName: string;
  fieldValue: unknown;
  startTime: number;
  endTime: number;
  query: string;
}

// `fieldName` may be an alias or an original name; stream links win over org links.
export const matchCrossLinks = (
  crossLinks: CrossLinks,
  fieldName: string,
): { originalFieldName: string; links: CrossLink[] } => {
  const { stream_links = [], org_links = [] } = crossLinks;

  const aliasToOriginal: Record<string, string> = {};
  for (const link of [...stream_links, ...org_links]) {
    for (const f of link.fields || []) {
      if (f.alias) aliasToOriginal[f.alias] = f.name;
    }
  }

  const originalFieldName = aliasToOriginal[fieldName] || fieldName;
  const covers = (link: CrossLink) =>
    !!link.fields?.some((f) => f.name === originalFieldName && f.alias);

  const streamLinks = stream_links.filter(covers);
  return { originalFieldName, links: streamLinks.length ? streamLinks : org_links.filter(covers) };
};

export const resolveCrossLinkUrl = (
  urlTemplate: string,
  { fieldName, fieldValue, startTime, endTime, query }: CrossLinkContext,
): string =>
  urlTemplate
    .replace(/\$\{field\.__name\}/g, encodeURIComponent(String(fieldName)))
    .replace(/\$\{field\.__value\}/g, encodeURIComponent(String(fieldValue ?? "")))
    .replace(/\$\{start_time\}/g, String(startTime))
    .replace(/\$\{end_time\}/g, String(endTime))
    .replace(/\$\{query\}/g, encodeURIComponent(query))
    .replace(/\$\{query_encoded\}/g, btoa(query));

// The resolved URL is checked, not the saved template: a field value can carry a hostile scheme.
export const openCrossLink = (url: string) => {
  if (!isSafeNavigableUrl(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
};
