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

import type { IncidentReachGap } from "@/utils/alerts/deliveryTarget";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { placeLabels } from "../../live/liveCopy";
import { deniedLine } from "../insightCta";
import {
  isAddable,
  type BulkKind,
  type FolderRef,
  type ReviewGroup,
  type ReviewRow,
} from "./useBulkReview";

// Lists name three items, then "and N more".
const LIST_NAMES = 3;

export type FailureReason =
  | { code: "forbidden"; folder: string }
  | { code: "duplicate"; name: string; folder: string }
  | { code: "timeout" | "invalid" | "missing" | "server" };

const list = (locale: string, items: string[]): string =>
  new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);

const number = (locale: string, value: number): string =>
  new Intl.NumberFormat(locale).format(Math.round(value));

/** Joins names with the locale's "and", naming three before "and N more". */
export const nameList = (t: TranslateFn, locale: string, names: string[]): string =>
  names.length <= LIST_NAMES + 1
    ? list(locale, names)
    : list(locale, [
        ...names.slice(0, LIST_NAMES),
        t("insight.bulk.more", { count: names.length - LIST_NAMES }),
      ]);

/** "folder ingest" or "folders ingest and ops". */
export const whereFolders = (t: TranslateFn, locale: string, folders: FolderRef[]): I18nText =>
  folders.length === 1
    ? t("insight.bulk.whereFolder", { folder: folders[0].name })
    : t("insight.bulk.whereFolders", {
        folders: nameList(
          t,
          locale,
          folders.map((f) => f.name),
        ),
      });

export const titleOf = (t: TranslateFn, kind: BulkKind, count: number): I18nText =>
  t(`insight.bulk.title.${kind}`, { count }, count);

const durationOf = (t: TranslateFn, minutes: number): I18nText =>
  minutes % 60 === 0
    ? t("insight.bulk.hours", { count: minutes / 60 }, minutes / 60)
    : t("insight.bulk.minutes", { count: minutes });

const commonPeriod = (rows: ReviewRow[]): number | null => {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const minutes = row.prefill?.periodMinutes;
    if (minutes) counts.set(minutes, (counts.get(minutes) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** The rule line under the title; the period is the one most rows use. */
export const ruleOf = (t: TranslateFn, kind: BulkKind, rows: ReviewRow[]): I18nText => {
  const minutes = commonPeriod(rows);
  // A mixed list has no one rule; each row's own "Fires when" says it.
  const mixed = rows.some((r) => (r.row.kind ?? kind) !== kind);
  const rule = mixed
    ? ""
    : kind === "no_data" || kind === "source"
      ? minutes
        ? t(`insight.bulk.rule.${kind}`, { duration: durationOf(t, minutes) })
        : ""
      : t(`insight.bulk.rule.${kind}`);
  return raw([rule, t("insight.bulk.ruleTail")].filter(Boolean).join(" "));
};

const placeKey = (r: ReviewRow) => [r.service, r.cluster ?? "", r.namespace ?? ""].join("\u0000");

const listLabels = new WeakMap<ReviewRow[], { t: TranslateFn; labels: Map<string, string> }>();

// A service's own drafts of other kinds share its place, so each place is named once per list.
const labelsOf = (t: TranslateFn, all: ReviewRow[]): Map<string, string> => {
  const kept = listLabels.get(all);
  if (kept?.t === t) return kept.labels;
  const places = [...new Map(all.map((r) => [placeKey(r), r])).values()];
  const names = placeLabels(
    t,
    places.map((r) => ({ name: r.service, cluster: r.cluster, namespace: r.namespace })),
  );
  const labels = new Map(places.map((r, i) => [placeKey(r), names[i]]));
  listLabels.set(all, { t, labels });
  return labels;
};

/** The coverage page's name for the service, else the coverage page's naming applied to the places in this list. */
export const serviceLabel = (t: TranslateFn, row: ReviewRow, all: ReviewRow[]): I18nText => {
  const scope = row.row.scope;
  const pageLabel = "field" in scope ? undefined : scope.label;
  if (pageLabel) return raw(pageLabel);
  return raw(labelsOf(t, all).get(placeKey(row)) ?? row.service);
};

/** Why AutoObserve offers no alert for a service whose name no row of its stream carries. */
export const noMatchLine = (t: TranslateFn, stream: string, service: I18nText | string): I18nText =>
  t("insight.bulk.block.noMatch", { stream: raw(stream), service: raw(String(service)) });

/** Why a row cannot be ticked: its stream fields, or a builder that could not make the alert. */
export const blockLine = (t: TranslateFn, row: ReviewRow, all: ReviewRow[] = [row]): I18nText => {
  const block = row.block;
  if (!block) return t("insight.bulk.cantBuild");
  if (block.code === "exists" || block.code === "existsFailed") return existsLine(t, row)!;
  if (block.code === "checking") return t("insight.bulk.block.checking");
  if (block.code === "measuring") return t("insight.threshold.measuring");
  if (block.code === "schemaFailed") {
    return t("insight.bulk.block.schemaFailed", { stream: row.stream.name });
  }
  if (block.code === "noMatch") return noMatchLine(t, row.stream.name, serviceLabel(t, row, all));
  if (block.code === "noBaseline") {
    return t(`insight.threshold.${block.kind}Reason`, { service: serviceLabel(t, row, all) });
  }
  return t(`insight.bulk.block.noField.${block.part}`, {
    stream: row.stream.name,
    value: block.value,
  });
};

const kindOf = (kind: BulkKind, row: ReviewRow): BulkKind => row.row.kind ?? kind;

export const firesWhenOf = (t: TranslateFn, kind: BulkKind, row: ReviewRow): I18nText => {
  const minutes = row.prefill?.periodMinutes;
  if (!row.prefill || !minutes) return raw("");
  const own = kindOf(kind, row);
  if (own === "errors" && row.threshold) {
    return t("insight.bulk.firesWhen.errors", { count: row.threshold });
  }
  if (own === "latency" && row.threshold) {
    return t("insight.bulk.firesWhen.latency", { value: `${row.threshold} ms` });
  }
  const key = row.stream.type === "traces" ? "noSpans" : "noRows";
  return t(`insight.bulk.firesWhen.${key}`, { duration: durationOf(t, minutes) });
};

// A quiet service's usual error count is a fraction of one an hour, which whole numbers would show as 0.
const level = (locale: string, value: number): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);

export const usuallyOf = (
  t: TranslateFn,
  locale: string,
  row: ReviewRow,
  kind: BulkKind = "no_data",
): I18nText => {
  const own = kindOf(kind, row);
  if (own === "errors" || own === "latency") {
    if (!row.usual) return raw("");
    return own === "errors"
      ? t("insight.bulk.usually", { rate: level(locale, row.usual) })
      : t("insight.bulk.usuallyLatency", { value: number(locale, row.usual) });
  }
  return row.row.usually === null
    ? raw("")
    : t("insight.bulk.usually", { rate: number(locale, row.row.usually) });
};

/** "Owner: ingest", "No owner yet", a folder name or a cluster. */
export const groupTitle = (t: TranslateFn, group: ReviewGroup): I18nText => {
  if (group.kind === "team") {
    return group.name ? t("insight.bulk.teamName", { team: group.name }) : t("insight.bulk.noTeam");
  }
  if (group.kind === "cluster") return group.name ? raw(group.name) : t("insight.bulk.noCluster");
  return raw(group.name ?? "");
};

/** Who a group's alerts reach: its destinations, "1 of 3 notify x" when only some rows have one, else on-call or no one. */
export const reachPart = (
  t: TranslateFn,
  locale: string,
  group: ReviewGroup,
  gap: IncidentReachGap,
): I18nText => {
  const named = group.rows.filter((r) => r.destinations.length).length;
  if (!named) {
    return gap === null ? t("insight.bulk.notifiesViaIncident") : t("insight.bulk.notifiesNone");
  }
  const destinations = nameList(t, locale, group.destinations);
  return named === group.rows.length
    ? t("insight.bulk.notifies", { destinations })
    : t("insight.bulk.notifiesSome", { count: named, total: group.rows.length, destinations });
};

/** "folder ingest · notifies ingest-oncall · 5", with the tick count of addable rows when some are unticked. */
export const groupMeta = (
  t: TranslateFn,
  locale: string,
  group: ReviewGroup,
  ticked: number,
  gap: IncidentReachGap = "both",
): I18nText[] => {
  const parts: I18nText[] = [];
  if (group.kind !== "folder") {
    if (group.folders.length > 1) {
      parts.push(t("insight.bulk.folders", { count: group.folders.length }));
    } else {
      const key = group.usesDefault ? "insight.bulk.folderDefault" : "insight.bulk.folder";
      parts.push(t(key, { folder: group.folders[0]?.name ?? "" }));
    }
  }
  parts.push(reachPart(t, locale, group, gap));
  if (group.locked) {
    parts.push(raw(number(locale, group.rows.length)));
    return parts;
  }
  // Added, unbuildable or never-firing rows are left out; a row that only needs a threshold counts.
  const addable = group.rows.filter(isAddable).length;
  if (addable === 0) parts.push(t("insight.bulk.nothingToAdd"));
  else if (ticked === addable) parts.push(raw(number(locale, addable)));
  else parts.push(t("insight.bulk.ticked", { ticked, count: addable }));
  return parts;
};

export const lockedLine = (t: TranslateFn, group: ReviewGroup): I18nText =>
  t("insight.bulk.locked", { folder: group.folders.map((f) => f.name).join(", ") });

export const copyRequestLabel = (t: TranslateFn, group: ReviewGroup): I18nText =>
  t("insight.bulk.copyRequest", { team: groupTitle(t, group) });

/** The text a user pastes to the folder's admins. */
export const requestText = (
  t: TranslateFn,
  locale: string,
  group: ReviewGroup,
  all: ReviewRow[],
): I18nText =>
  t(
    "insight.bulk.request",
    {
      count: group.rows.length,
      folder: group.folders.map((f) => f.name).join(", "),
      services: list(
        locale,
        group.rows.map((r) => serviceLabel(t, r, all)),
      ),
    },
    group.rows.length,
  );

/** The neutral banner: how many the user can add, and which folders refuse the rest. */
export const rightsBanner = (
  t: TranslateFn,
  locale: string,
  rows: ReviewRow[],
): I18nText | null => {
  const locked = rows.filter((r) => r.locked);
  if (locked.length === 0) return null;
  const folders = [...new Map(locked.map((r) => [r.folder.id, r.folder])).values()];
  return t(
    "insight.bulk.rights",
    {
      can: rows.length - locked.length,
      total: rows.length,
      locked: locked.length,
      where: whereFolders(t, locale, folders),
    },
    locked.length,
  );
};

/** "8 alerts will be created: 5 in folder ingest, 3 in folder ops." */
export const footerOf = (
  t: TranslateFn,
  locale: string,
  counts: { folder: FolderRef; count: number }[],
): I18nText => {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return t("insight.bulk.footerNone");
  if (counts.length === 1) {
    return t(
      "insight.bulk.footer",
      { count: total, where: whereFolders(t, locale, [counts[0].folder]) },
      total,
    );
  }
  const named = counts.length <= LIST_NAMES + 1 ? counts : counts.slice(0, LIST_NAMES);
  const rest = counts.slice(named.length);
  const parts = named.map((c) =>
    t("insight.bulk.footerPart", { count: c.count, folder: c.folder.name }),
  );
  if (rest.length) {
    parts.push(
      t("insight.bulk.footerRest", {
        count: rest.reduce((sum, c) => sum + c.count, 0),
        folders: rest.length,
      }),
    );
  }
  return t("insight.bulk.footerSplit", { count: total, parts: parts.join(", ") });
};

export const reasonOf = (t: TranslateFn, reason: FailureReason): I18nText => {
  if (reason.code === "forbidden") {
    return t("insight.bulk.reason.forbidden", {
      denied: deniedLine(t, "addAlert"),
      folder: reason.folder,
    });
  }
  if (reason.code === "duplicate") {
    return t("insight.bulk.reason.duplicate", { name: reason.name, folder: reason.folder });
  }
  return t(`insight.bulk.reason.${reason.code}`);
};

export const failureLine = (t: TranslateFn, service: string, reason: FailureReason): I18nText =>
  t("insight.bulk.failure", { service, reason: reasonOf(t, reason) });

export const partialBanner = (t: TranslateFn, failed: number, total: number): I18nText =>
  t("insight.bulk.partial", { failed, total }, failed);

export const createdLine = (t: TranslateFn, locale: string, folders: FolderRef[], count: number) =>
  t("insight.bulk.createdIn", { count, where: whereFolders(t, locale, folders) }, count);

/** How many rows Add left out because their alert already existed when it re-checked. */
export const skippedLine = (t: TranslateFn, count: number): I18nText =>
  t("insight.bulk.skipped", { count }, count);

/** Why a row can't be added: its alert already exists, or the org's alerts couldn't be read to tell. */
export const existsLine = (t: TranslateFn, row: ReviewRow): I18nText | null => {
  const block = row.block;
  if (block?.code === "exists") {
    return t("insight.bulk.block.exists", {
      name: block.alert.name,
      folder: block.alert.folderName,
    });
  }
  return block?.code === "existsFailed" ? t("insight.bulk.block.existsFailed") : null;
};

/** The footer's first line while some rows can't be added until the user sets their threshold. */
export const needsThresholdLine = (t: TranslateFn, count: number): I18nText =>
  t("insight.bulk.needsThreshold", { count }, count);

/** The footer's reason when rows were left out because their alerts already exist. */
export const existingFooter = (t: TranslateFn, rows: ReviewRow[]): I18nText | null => {
  const count = rows.filter((r) => r.block?.code === "exists").length;
  if (!count) return null;
  return count === rows.length
    ? t("insight.bulk.existsAll", { count }, count)
    : t("insight.bulk.existsSome", { count }, count);
};

/** The success toast, saying until when Undo works. */
export const toastOf = (t: TranslateFn, locale: string, folders: FolderRef[], count: number) =>
  raw(
    `${t("insight.bulk.toast", { count, where: whereFolders(t, locale, folders) }, count)} ${t("insight.bulk.undoHint")}`,
  );
