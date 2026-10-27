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

interface PanelStreamType {
  queries?: { fields?: { stream?: string; stream_type?: string } }[];
}

interface StreamTimeStats {
  stats?: { doc_time_min?: number; doc_time_max?: number; created_at?: number };
}

/** True when the panel reads an enrichment table, whose rows carry their upload time. */
export const isEnrichmentTablePanel = (panelSchema: PanelStreamType | null | undefined): boolean =>
  panelSchema?.queries?.[0]?.fields?.stream_type === "enrichment_tables";

/** The whole table's span in microseconds, padded as Explore does and ending no earlier than now. */
export const getEnrichmentTableRange = async (
  getStream: (name: string, type: string, schema: boolean) => Promise<StreamTimeStats | null>,
  panelSchema: PanelStreamType | null | undefined,
): Promise<{ from: number; to: number } | null> => {
  const stream = panelSchema?.queries?.[0]?.fields?.stream;
  if (!stream || !isEnrichmentTablePanel(panelSchema)) return null;
  const stats = (await getStream(stream, "enrichment_tables", false).catch(() => null))?.stats;
  const start = stats?.doc_time_min
    ? stats.doc_time_min - 1_000_000
    : (stats?.created_at ?? 0) - 60_000_000;
  if (start <= 0) return null;
  const end = Math.max((stats?.doc_time_max ?? 0) + 60_000_000, Date.now() * 1000);
  return { from: start, to: end };
};
