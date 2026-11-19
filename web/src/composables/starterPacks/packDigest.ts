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

import { parseLogEntries } from "@/components/O2AIChat.content";

import { PACK_DIGEST_NAME } from "./packDigestName";
import type { HomePackRowItem } from "./useHomePacks";
import { leftOutIds, type PackItemKind } from "./types";

export { PACK_DIGEST_NAME };

export const DIGEST_MAX_PACKS = 3;
export const DIGEST_MAX_CHARS = 2000;

const LINE_MAX = 400;
const TITLE_MAX = 80;
const ELLIPSIS = "…";
const RULE =
  "Recommend only these packs. Do not create these items yourself; the user sets them up with the Set up button.";
const PACK_LINE = /^Pack: .* \(id: ([\w.-]+)\)$/gm;

export type DigestItem = Pick<HomePackRowItem, "pack" | "title" | "matcher" | "flow">;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}${ELLIPSIS}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const withSummary = (name: string, summary?: string) => (summary ? `${name} (${summary})` : name);

// The preview knows what the data supports, so once loaded it narrows the catalog lists.
const plannedIds = (item: DigestItem, kind: PackItemKind): Set<string> | null => {
  const preview = item.flow.preview.value;
  if (!preview) return null;
  const left = new Set(leftOutIds(preview));
  return new Set(
    preview.items
      .filter((row) => row.kind === kind && row.status !== "existing" && !left.has(row.itemId))
      .map((row) => row.copyOf ?? row.itemId),
  );
};

const countsLine = (item: DigestItem): string | null => {
  const { dashboardCount, alertCount, viewCount } = item.flow;
  if (dashboardCount.value === null || alertCount.value === null || viewCount.value === null) {
    return null;
  }
  return `Creates: ${[
    plural(dashboardCount.value, "dashboard", "dashboards"),
    plural(alertCount.value, "alert", "alerts"),
    plural(viewCount.value, "saved view", "saved views"),
  ].join(", ")}`;
};

const detailLines = (item: DigestItem): string[] => {
  const { pack } = item;
  const keep = (kind: PackItemKind) => {
    const planned = plannedIds(item, kind);
    return (id: string) => !planned || planned.has(id);
  };
  const dashboards = pack.dashboards
    .filter(({ id }) => keep("dashboard")(id))
    .map(({ title, summary }) => withSummary(title, summary));
  const alerts = pack.alerts.filter(keep("alert")).map((id) => pack.alertSummaries?.[id] ?? id);
  const views = pack.savedViews
    .filter(({ id }) => keep("savedView")(id))
    .map(({ name, summary }) => withSummary(name, summary));
  const streams = item.matcher.streams.value;
  return [
    streams.length ? `Matched streams: ${streams.join(", ")}` : null,
    countsLine(item),
    dashboards.length ? `Dashboards: ${dashboards.join("; ")}` : null,
    alerts.length ? `Alerts: ${alerts.join("; ")}` : null,
    views.length ? `Saved views: ${views.join("; ")}` : null,
  ]
    .filter((line): line is string => line !== null)
    .map((line) => clip(line, LINE_MAX));
};

const idLine = (item: DigestItem) =>
  `Pack: ${clip(String(item.title), TITLE_MAX)} (id: ${item.pack.id})`;

/** The matched packs as plain text for the assistant; the first line labels the sent block. */
export function buildPackDigest(items: DigestItem[]): string {
  const shown = items.slice(0, DIGEST_MAX_PACKS);
  const head = `${PACK_DIGEST_NAME}: ${shown.map(({ title }) => String(title)).join(", ")}`;
  const ids = shown.map(idLine);
  // Every pack's id line is paid for first, so the action row reads back each pack the head names.
  let budget =
    DIGEST_MAX_CHARS -
    head.length -
    RULE.length -
    2 -
    ids.reduce((sum, id) => sum + id.length + 2, 0);
  const body = shown.flatMap((item, index) => {
    const fitting = detailLines(item).filter((line) => {
      if (line.length + 1 > budget) return false;
      budget -= line.length + 1;
      return true;
    });
    return ["", ids[index], ...fitting];
  });
  return [head, ...body, "", RULE].join("\n");
}

/** Pack ids of a digest block in a sent message, in digest order; empty when it has none. */
export function digestPackIds(content: string): string[] {
  if (!content || !content.includes(PACK_DIGEST_NAME)) return [];
  const block = parseLogEntries(content).find(
    (entry) => entry.type === "log_entry" && String(entry.filename).trim() === PACK_DIGEST_NAME,
  );
  if (!block) return [];
  return [...String(block.content).matchAll(PACK_LINE)].map((match) => match[1]);
}
