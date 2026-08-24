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

// Display vocabulary for the alert library's three facets (pack, category,
// severity). One module so the rail, the cards and the stat strip cannot drift
// into labelling the same value two different ways.

import type { LibrarySeverity } from "@/constants/alertLibrary";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

/** A rail entry: one facet value plus how many alerts carry it. */
export interface LibraryFacet {
  id: string;
  label: I18nText;
  count: number;
}

/** Rail order for severity — hottest first, matching the card sort. */
export const SEVERITY_ORDER: readonly LibrarySeverity[] = ["critical", "warning", "info"] as const;

/** Sort rank for a library severity; unknown values sort last. */
export const severityRank = (severity: string): number => {
  const index = SEVERITY_ORDER.indexOf(severity as LibrarySeverity);
  return index === -1 ? SEVERITY_ORDER.length : index;
};

/**
 * Library severity -> a value the `severity` badge group knows.
 *
 * The group has no `warning` entry (its scale is critical/high/medium/low/info),
 * so warning maps to `medium` — the amber that the group also gives P3, which is
 * exactly the priority `SEVERITY_TO_PRIORITY` installs a warning alert as. The
 * colour therefore matches what the alert will look like once installed.
 */
export const SEVERITY_BADGE_VALUE: Record<LibrarySeverity, string> = {
  critical: "critical",
  warning: "medium",
  info: "info",
};

/** Keys are library vocabulary, so the label is ours rather than the group's. */
const SEVERITY_LABEL_KEY: Record<LibrarySeverity, I18nKey> = {
  critical: "alert_library.severityCritical",
  warning: "alert_library.severityWarning",
  info: "alert_library.severityInfo",
};

const isLibrarySeverity = (value: string): value is LibrarySeverity =>
  Object.hasOwn(SEVERITY_LABEL_KEY, value);

/** Badge-group value for a severity; unknown values pass through unchanged. */
export const severityBadgeValue = (severity: string): string =>
  isLibrarySeverity(severity) ? SEVERITY_BADGE_VALUE[severity] : severity;

/**
 * Translated severity label. An unrecognised severity (the manifest is fetched
 * content) shows its own id rather than being silently relabelled.
 */
export const severityLabel = (t: TranslateFn, severity: string): I18nText =>
  isLibrarySeverity(severity) ? t(SEVERITY_LABEL_KEY[severity]) : raw(severity);

/**
 * Pack display names. Product names — `raw()` because there is one correct form
 * worldwide, and an unknown pack falls back to its id so the library can add a
 * pack without a frontend release.
 */
const PACK_LABELS: Record<string, string> = {
  k8s: "Kubernetes",
  openobserve: "OpenObserve",
};

export const packLabel = (id: string): I18nText =>
  raw(typeof id === "string" && Object.hasOwn(PACK_LABELS, id) ? PACK_LABELS[id] : id);

/**
 * Category ids are library data (`control-plane`, `k8s-events`), not product
 * copy, so they are humanised rather than translated: a category added upstream
 * must render without a frontend change, which a key table cannot promise.
 */
export const categoryLabel = (id: string): I18nText => {
  if (typeof id !== "string" || id === "") return raw("");
  const words = id.replace(/[_-]+/g, " ").trim();
  return raw(words.charAt(0).toUpperCase() + words.slice(1));
};
