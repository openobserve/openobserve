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

import { isEqual } from "lodash-es";

import {
  authoredFromDraft,
  authoredFromStyle,
  parseDurationMs,
  rawBanners,
  type BannerDraft,
  type BannerStyle,
  type IndexedDraft,
} from "./announcementDrafts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type BannerStatus = "live" | "scheduled" | "ended" | "always";

/** A list row's status: a live promo can still be suppressed by a live critical banner. */
export type ListStatus = BannerStatus | "hidden";

/** What saving the draft does right now, which names the save button and the toast. */
export type SaveIntent = "publish" | "schedule" | "save";

export type AnnouncementConfig = Record<string, unknown> & {
  banners: unknown[];
};

function instantMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function withBanners(source: unknown, banners: unknown[]): AnnouncementConfig {
  const base = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
  return { ...base, banners };
}

/** Where a banner stands against the clock, from its authored schedule. */
export function bannerStatus(draft: BannerDraft, nowMs: number): BannerStatus {
  if (draft.schedule === "always") return "always";
  // A legacy duration-only banner was anchored by the server at save time, which the client cannot see.
  if (draft.schedule === "duration") return "live";

  const start = instantMs(draft.startsAt);
  const end = instantMs(draft.endsAt);
  if (start != null && nowMs < start) return "scheduled";
  if (end != null && nowMs >= end) return "ended";
  return "live";
}

export function isShowingNow(draft: BannerDraft, nowMs: number): boolean {
  const status = bannerStatus(draft, nowMs);
  return status === "live" || status === "always";
}

/** A showing promotion every one of whose organizations also sees a live critical banner. */
export function isHiddenByCritical(
  draft: BannerDraft,
  others: BannerDraft[],
  nowMs: number,
): boolean {
  if (draft.variant !== "promo" || !isShowingNow(draft, nowMs)) return false;

  const critical = others.filter((d) => d.variant === "critical" && isShowingNow(d, nowMs));
  if (critical.some((d) => !d.orgs.length)) return true;
  if (!critical.length || !draft.orgs.length) return false;

  const covered = new Set(critical.flatMap((d) => d.orgs));
  return draft.orgs.every((org) => covered.has(org));
}

/** Each entry's list status, with promotions a critical banner hides from all their orgs marked hidden. */
export function listStatuses(entries: IndexedDraft[], nowMs: number): Map<number, ListStatus> {
  return new Map(
    entries.map(({ index, draft }) => {
      const others = entries.filter((entry) => entry.index !== index).map((entry) => entry.draft);
      const hidden = isHiddenByCritical(draft, others, nowMs);
      return [index, hidden ? "hidden" : bannerStatus(draft, nowMs)];
    }),
  );
}

/** Milliseconds until a live banner's end, or null when it has none. */
export function remainingMs(draft: BannerDraft, nowMs: number): number | null {
  if (draft.schedule !== "window" || bannerStatus(draft, nowMs) !== "live") return null;
  const end = instantMs(draft.endsAt);
  return end == null ? null : end - nowMs;
}

/** A compact span such as `45m`, `23h` or `3d`. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes}m`;
  if (ms < 2 * DAY_MS) return `${Math.round(ms / HOUR_MS)}h`;
  return `${Math.round(ms / DAY_MS)}d`;
}

/** A short local stamp such as `Oct 8 10:33`, optionally followed by the zone abbreviation. */
export function formatStamp(value: string, withZone = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const stamp = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  if (!withZone) return stamp;
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  return zone ? `${stamp} ${zone}` : stamp;
}

/** Whether saving publishes the banner now, schedules it, or only stores it. */
export function saveIntent(draft: BannerDraft, nowMs: number): SaveIntent {
  if (draft.schedule === "duration") return parseDurationMs(draft.duration) ? "publish" : "save";
  const status = bannerStatus(draft, nowMs);
  if (status === "scheduled") return "schedule";
  return status === "ended" ? "save" : "publish";
}

/** True when the latest config still holds `original` at `index`, so a write cannot clobber someone else's edit. */
export function isUnchangedAt(latest: unknown, index: number, original: unknown): boolean {
  const banners = rawBanners(latest);
  return index < banners.length && isEqual(banners[index], original);
}

/** The config with `draft` stored at `index`, or appended when `index` is null; others pass through untouched. */
export function upsertBanner(
  source: unknown,
  index: number | null,
  draft: BannerDraft,
): AnnouncementConfig {
  const banners = [...rawBanners(source)];
  const authored = authoredFromDraft(draft);

  if (index == null || index < 0 || index >= banners.length) {
    banners.push(authored);
  } else {
    banners[index] = authored;
  }

  return withBanners(source, banners);
}

export function removeBanner(source: unknown, index: number): AnnouncementConfig {
  return withBanners(
    source,
    rawBanners(source).filter((_, position) => position !== index),
  );
}

function rawStyles(source: unknown): unknown[] {
  const styles = (source as { styles?: unknown } | null)?.styles;
  return Array.isArray(styles) ? styles : [];
}

/** The config with `style` appended to its saved styles; banners and other keys pass through. */
export function addStyle(source: unknown, style: BannerStyle): AnnouncementConfig {
  return {
    ...withBanners(source, rawBanners(source)),
    styles: [...rawStyles(source), authoredFromStyle(style)],
  };
}

export function removeStyle(source: unknown, id: string): AnnouncementConfig {
  return {
    ...withBanners(source, rawBanners(source)),
    styles: rawStyles(source).filter((style) => (style as { id?: unknown })?.id !== id),
  };
}

/** The stored index named by a route query value, or null when it is absent or not an integer. */
export function parseIndexQuery(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}
