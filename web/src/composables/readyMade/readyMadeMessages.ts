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

import type { I18nText, TranslateFn } from "@/types/i18n";
import { getReadyMadeSource } from "./catalog";
import type { ReadyMadeInstallResult, ReadyMadeInstalledDashboard } from "./installReadyMade";

export type ReadyMadeInstallSuccess = Extract<
  ReadyMadeInstallResult,
  { status: "created" | "exists" }
>;

/** Product names and dashboard titles joined the way the locale lists things. */
export const joinReadyMadeNames = (
  names: string[],
  locale: string,
  type: "conjunction" | "unit" = "conjunction",
): string => new Intl.ListFormat(locale, { style: "long", type }).format(names);

export const createdReadyMadeDashboards = (
  result: ReadyMadeInstallSuccess,
): ReadyMadeInstalledDashboard[] => result.dashboards.filter((dashboard) => dashboard.created);

/** Only some of an already-installed set were created, so a count alone would hide which came back. */
export const isReadyMadeGapFill = (result: ReadyMadeInstallSuccess): boolean => {
  const created = createdReadyMadeDashboards(result).length;
  return created > 0 && created < result.dashboards.length;
};

/** The dashboard an entry point opens: the one that came back after a gap fill, else the set's first. */
export const primaryReadyMadeDashboard = (
  result: ReadyMadeInstallSuccess,
): ReadyMadeInstalledDashboard =>
  isReadyMadeGapFill(result) ? createdReadyMadeDashboards(result)[0] : result.dashboards[0];

/** One sentence for what an install did: added the set, added back the named missing ones, or found it in place. */
export function describeReadyMadeInstall(
  result: ReadyMadeInstallSuccess,
  t: TranslateFn,
  locale: string,
): I18nText {
  const created = createdReadyMadeDashboards(result);
  const count = result.dashboards.length;
  const name = getReadyMadeSource(result.sourceId).name;
  if (created.length === 0) {
    return t("dashboard.readyMade.existsOne", { name, folder: result.folderName, count }, count);
  }
  // New copies land in the source's own folder, which is not where a moved set lives.
  const folder = created[0].folderName;
  if (created.length === count) {
    return t("dashboard.readyMade.addedOne", { name, folder, count }, count);
  }
  const list = joinReadyMadeNames(
    created.map((dashboard) => dashboard.title),
    locale,
  );
  return t("dashboard.readyMade.missingAdded", { list, folder }, created.length);
}
