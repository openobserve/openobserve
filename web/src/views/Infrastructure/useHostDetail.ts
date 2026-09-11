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

// Logs-preview helpers for the host detail drawer. The metrics grid moved to
// the hosts content pack and the curated engine (curated-pages design §8.2).

import { ref } from "vue";
import useStreams from "@/composables/useStreams";
import { gt } from "@/types/i18n";
import { loadSemanticGroups } from "@/utils/semanticGroupsCache";
import { GROUP } from "./curated/types";
import { sqlEscape } from "./curated/resolve";
import type { StreamListEntry } from "./curated/resolve";
import { readStreamSchemaCached } from "./curated/useCuratedPage";

/**
 * Why no host logs could be searched — the drawer tells the user which of these
 * it hit rather than running a query that silently returns nothing.
 */
export type HostLogsMissReason = "no-log-streams" | "no-host-field";

export interface HostLogsTarget {
  stream: string | null;
  field: string | null;
  reason: HostLogsMissReason | null;
}

export const LOGS_PREVIEW_LIMIT = 100;

/** The host field this falls back to when no semantic group is available. */
export const HOST_LOGS_FALLBACK_FIELD = "host_name";

/**
 * Mirrors the backend's `is_internal_rollup_stream`
 * (config/src/meta/self_reporting/usage.rs:99). A PREFIX, not a list, for the
 * reason stated there: the `_o2_` family grows with every new rollup job. The
 * stream list API applies no such filter, so a host drawer sees these unless we
 * drop them here.
 */
const isInternalStream = (name: string): boolean =>
  name.startsWith("_o2_") || name === "_agent_signals";

/** The most schemas one resolve will read — a 200-stream org must not fan out 200 requests. */
export const MAX_SCHEMA_PROBES = 25;

// Re-exported from their new home so existing importers keep working (§8.2).
export { promEscape, sqlEscape } from "./curated/resolve";

/**
 * The log stream to search for a host's logs, chosen by evidence: the first
 * stream whose READ schema carries a field from the org's semantic host group,
 * ranked by that group's own alias order. There is no org-independent right
 * answer — a stream named "default" need not exist and need not carry a host
 * field — so an unresolvable case returns a reason instead of a guess.
 */
export function resolveHostLogsTarget({
  streams,
  hostFieldAliases,
}: {
  streams: StreamListEntry[];
  hostFieldAliases: string[];
}): HostLogsTarget {
  // A database-monitoring rollup carries a host column but is not this host's logs.
  const searchable = streams.filter((entry) => !isInternalStream(entry.name));
  // An org with only internal streams has no logs to search — blaming the schema
  // would report OUR filter as the user's missing field.
  if (searchable.length === 0) return { stream: null, field: null, reason: "no-log-streams" };

  let best: { stream: string; field: string; rank: number; hasRows: boolean } | null = null;
  for (const entry of searchable) {
    // An unread schema is absence of evidence, not evidence of a host field.
    const fields = new Set((entry.schema ?? []).map((field) => field.name));
    for (let rank = 0; rank < hostFieldAliases.length; rank++) {
      if (!fields.has(hostFieldAliases[rank])) continue;
      // doc_num 0 also means "stats not computed yet", so it only ever breaks a tie.
      const hasRows = (entry.stats?.doc_num ?? 1) > 0;
      const better = !best || (hasRows === best.hasRows ? rank < best.rank : hasRows);
      if (better) best = { stream: entry.name, field: hostFieldAliases[rank], rank, hasRows };
      break;
    }
  }

  if (!best) return { stream: null, field: null, reason: "no-host-field" };
  return { stream: best.stream, field: best.field, reason: null };
}

/**
 * Resolves the host-logs target against the org's live streams. Schemas are read
 * only for the log streams the org actually has, and the alias order comes from
 * the org's semantic `host` group so this file never hardcodes a spelling.
 */
export function useHostLogsTarget() {
  const { getStreams, getStream } = useStreams(gt);
  const target = ref<HostLogsTarget | null>(null);
  const resolving = ref(false);

  const resolve = async (orgId: string): Promise<HostLogsTarget> => {
    resolving.value = true;
    try {
      const [listed, groups] = await Promise.all([
        getStreams("logs", false, false).catch(() => null),
        loadSemanticGroups(orgId).catch(() => []),
      ]);
      const listedEntries = ((listed as any)?.list ?? []) as StreamListEntry[];
      const aliases = groups.find((group) => group.id === GROUP.host)?.fields ?? [
        HOST_LOGS_FALLBACK_FIELD,
      ];
      // The list read carries stats but never a schema (getStreams forces schema=false),
      // so narrowing HERE is free while every survivor costs one request below.
      const candidates = listedEntries
        .filter((entry) => !isInternalStream(entry.name))
        .sort((a, b) => (b.stats?.doc_num ?? 0) - (a.stats?.doc_num ?? 0))
        .slice(0, MAX_SCHEMA_PROBES);
      const entries = await Promise.all(
        candidates.map(async (candidate): Promise<StreamListEntry> => {
          const { name } = candidate;
          try {
            const fetched = await readStreamSchemaCached(
              orgId,
              "logs",
              name,
              () => getStream(name, "logs", true) as Promise<StreamListEntry | undefined>,
            );
            return { name, stats: candidate.stats, schema: fetched?.schema ?? null };
          } catch {
            // A failed schema read drops that candidate, never the whole resolve.
            return { name, stats: candidate.stats, schema: null };
          }
        }),
      );
      const resolved = resolveHostLogsTarget({ streams: entries, hostFieldAliases: aliases });
      target.value = resolved;
      return resolved;
    } finally {
      resolving.value = false;
    }
  };

  return { target, resolving, resolve };
}

export function buildLogsPreviewSql(
  host: string,
  target: { stream: string; field: string },
): string {
  return `SELECT * FROM "${target.stream}" WHERE ${target.field} = '${sqlEscape(host)}' ORDER BY _timestamp DESC LIMIT ${LOGS_PREVIEW_LIMIT}`;
}
