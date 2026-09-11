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
  if (streams.length === 0) return { stream: null, field: null, reason: "no-log-streams" };

  let best: { stream: string; field: string; rank: number } | null = null;
  for (const entry of streams) {
    // An unread schema is absence of evidence, not evidence of a host field.
    const fields = new Set((entry.schema ?? []).map((field) => field.name));
    for (let rank = 0; rank < hostFieldAliases.length; rank++) {
      if (!fields.has(hostFieldAliases[rank])) continue;
      if (!best || rank < best.rank) {
        best = { stream: entry.name, field: hostFieldAliases[rank], rank };
      }
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
      const names: string[] = (((listed as any)?.list ?? []) as Array<{ name: string }>).map(
        (entry) => entry.name,
      );
      const aliases = groups.find((group) => group.id === GROUP.host)?.fields ?? [
        HOST_LOGS_FALLBACK_FIELD,
      ];
      const entries = await Promise.all(
        names.map(async (name): Promise<StreamListEntry> => {
          try {
            const fetched = (await getStream(name, "logs", true)) as StreamListEntry | undefined;
            return { name, schema: fetched?.schema ?? null };
          } catch {
            // A failed schema read drops that candidate, never the whole resolve.
            return { name, schema: null };
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
