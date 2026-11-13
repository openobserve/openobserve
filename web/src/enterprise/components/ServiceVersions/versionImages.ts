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

import type { TranslateFn } from "@/types/i18n";

export const BASELINE_IMAGES_SHOWN = 5;
export const PANEL_IMAGES_SHOWN = 3;
const IMAGE_SOURCES = ["container.image.tag", "k8s.pod.image"];

interface ImageRow {
  version: string;
  version_key: string;
  first_seen: number;
  last_seen: number;
}

export interface HiddenImages {
  version: string;
  count: number;
  from: number;
  to: number;
  /** The last shown row of the version, which the summary line follows. */
  after: string;
}

/** Keeps each version's rows together, in the order the version first appears, rows in their given order. */
export function groupByVersion<T extends ImageRow>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.version, [...(groups.get(row.version) ?? []), row]);
  return [...groups.values()].flat();
}

/** Shows the first `cap` rows of each version and summarises the rest, unless that version is expanded. */
export function capImageRows<T extends ImageRow>(
  rows: T[],
  cap: number,
  expanded: ReadonlySet<string> = new Set(),
): { rows: T[]; more: HiddenImages[] } {
  const seen = new Map<string, number>();
  const shown: T[] = [];
  const hidden = new Map<string, HiddenImages>();
  for (const row of groupByVersion(rows)) {
    const index = seen.get(row.version) ?? 0;
    seen.set(row.version, index + 1);
    if (index < cap || expanded.has(row.version)) {
      shown.push(row);
      continue;
    }
    const last = shown.findLast((item) => item.version === row.version);
    const entry = hidden.get(row.version) ?? {
      version: row.version,
      count: 0,
      from: row.first_seen,
      to: row.last_seen,
      after: last?.version_key ?? "",
    };
    entry.count += 1;
    entry.from = Math.min(entry.from, row.first_seen);
    entry.to = Math.max(entry.to, row.last_seen);
    hidden.set(row.version, entry);
  }
  return { rows: shown, more: [...hidden.values()] };
}

/** True when the version's text came from the container image rather than from the service. */
export function isImageSource(source: string | null | undefined) {
  return IMAGE_SOURCES.includes(source || "");
}

/** The one sentence saying why compare is off for a version, or "" when it is on. */
export function compareDisabledText(
  row: { compare_disabled?: boolean; compare_disabled_reason?: string | null },
  t: TranslateFn,
) {
  if (!row.compare_disabled) return "";
  return t("serviceVersions.versionSource.noSpanVersion");
}

/** A short locale-aware day range, e.g. "3 Nov – 9 Nov". */
export function dayRange(fromUs: number, toUs: number, locale: string) {
  const format = new Intl.DateTimeFormat(locale || "en", { day: "numeric", month: "short" });
  const from = format.format(new Date(fromUs / 1000));
  const to = format.format(new Date(toUs / 1000));
  return from === to ? from : `${from} – ${to}`;
}
