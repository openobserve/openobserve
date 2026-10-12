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

import announcements from "@/services/announcements";
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

/** Saves that keep losing the race to other saves give up rather than retry forever. */
const MAX_SAVE_ATTEMPTS = 3;

/** How far ahead of this browser a server pin can plausibly be anchored, for clock skew. */
const PIN_ANCHOR_SLACK_MS = 5 * MINUTE_MS;
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

/** Thrown when the part of the config a change edits moved since the page loaded it. */
export class AnnouncementConflictError extends Error {}

function instantMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function withBanners(source: unknown, banners: unknown[]): AnnouncementConfig {
  const base =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};
  return { ...base, banners };
}

// A span with no explicit start is anchored to whenever the server last read it, so it is treated as open-ended.
function endMs(draft: BannerDraft, start: number | null): number | null {
  if (draft.end === "at") return instantMs(draft.endsAt);
  const span = draft.end === "after" ? parseDurationMs(draft.duration) : null;
  return span != null && start != null ? start + span : null;
}

/** Where a banner stands against the clock, from its authored schedule. */
export function bannerStatus(draft: BannerDraft, nowMs: number): BannerStatus {
  const start = draft.start === "at" ? instantMs(draft.startsAt) : null;
  const end = endMs(draft, start);
  if (start == null && draft.end === "never") return "always";

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

  const critical = others.filter(
    (d) => d.variant === "critical" && isShowingNow(d, nowMs),
  );
  if (critical.some((d) => !d.orgs.length)) return true;
  if (!critical.length || !draft.orgs.length) return false;

  const covered = new Set(critical.flatMap((d) => d.orgs));
  return draft.orgs.every((org) => covered.has(org));
}

/** Each entry's list status, with promotions a critical banner hides from all their orgs marked hidden. */
export function listStatuses(
  entries: IndexedDraft[],
  nowMs: number,
): Map<number, ListStatus> {
  return new Map(
    entries.map(({ index, draft }) => {
      const others = entries
        .filter((entry) => entry.index !== index)
        .map((entry) => entry.draft);
      const hidden = isHiddenByCritical(draft, others, nowMs);
      return [index, hidden ? "hidden" : bannerStatus(draft, nowMs)];
    }),
  );
}

/** Milliseconds until a live banner's end, or null when it has none. */
export function remainingMs(draft: BannerDraft, nowMs: number): number | null {
  if (draft.end !== "at" || bannerStatus(draft, nowMs) !== "live") return null;
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
  if (draft.end === "after" && !parseDurationMs(draft.duration)) return "save";
  const status = bannerStatus(draft, nowMs);
  if (status === "scheduled") return "schedule";
  return status === "ended" ? "save" : "publish";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `stored.ends_at` is where the server would have pinned `original`'s duration. */
function isPinnedEnd(
  stored: Record<string, unknown>,
  original: Record<string, unknown>,
): boolean {
  const span = parseDurationMs(String(original.duration));
  const anchor = Date.parse(String(stored.ends_at)) - (span ?? NaN);
  if (Number.isNaN(anchor)) return false;
  if (typeof original.starts_at === "string") {
    return Math.abs(anchor - Date.parse(original.starts_at)) < 1000;
  }
  // Unstarted, the pin is anchored to an unknown save time; only an anchor in the future is provably not a pin.
  return anchor <= Date.now() + PIN_ANCHOR_SLACK_MS;
}

/** Whether `stored` is `original` with its `duration` pinned to an `ends_at`, as every save does. */
function isPinnedFrom(stored: unknown, original: unknown): boolean {
  if (!isRecord(stored) || !isRecord(original)) return false;
  if (typeof original.duration !== "string" || "duration" in stored)
    return false;
  if (typeof stored.ends_at !== "string" || !isPinnedEnd(stored, original))
    return false;

  const { duration: _duration, ...authored } = original;
  const { ends_at: _endsAt, ...pinned } = stored;
  return isEqual(pinned, authored);
}

/** True when the latest config still holds `original` at `index`, so a write cannot clobber someone else's edit. */
export function isUnchangedAt(
  latest: unknown,
  index: number,
  original: unknown,
): boolean {
  const banners = rawBanners(latest);
  if (index >= banners.length) return false;
  return (
    isEqual(banners[index], original) || isPinnedFrom(banners[index], original)
  );
}

/** The config with `draft` stored at `index`, or appended (keeping `base`'s unedited keys) when `index` is null. */
export function upsertBanner(
  source: unknown,
  index: number | null,
  draft: BannerDraft,
  base: Record<string, unknown> = {},
): AnnouncementConfig {
  const banners = [...rawBanners(source)];

  if (index == null || index < 0 || index >= banners.length) {
    banners.push(authoredFromDraft(draft, base));
  } else {
    const stored = banners[index];
    banners[index] = authoredFromDraft(draft, isRecord(stored) ? stored : {});
  }

  return withBanners(source, banners);
}

export function removeBanner(
  source: unknown,
  index: number,
): AnnouncementConfig {
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
export function addStyle(
  source: unknown,
  style: BannerStyle,
): AnnouncementConfig {
  return {
    ...withBanners(source, rawBanners(source)),
    styles: [...rawStyles(source), authoredFromStyle(style)],
  };
}

/** The config without saved style `id`, and without the label that pointed banners at it. */
export function removeStyle(source: unknown, id: string): AnnouncementConfig {
  const banners = rawBanners(source).map((banner) => {
    if (!isRecord(banner) || banner.style !== id) return banner;
    const { style: _style, ...rest } = banner;
    return rest;
  });
  return {
    ...withBanners(source, banners),
    styles: rawStyles(source).filter(
      (style) => (style as { id?: unknown })?.id !== id,
    ),
  };
}

/** Read-modify-write of the whole config; the server refuses a write based on a stale read, which is re-read and re-applied. */
export async function updateConfig(
  org: string,
  change: (latest: unknown) => AnnouncementConfig,
): Promise<AnnouncementConfig> {
  for (let attempt = 1; ; attempt++) {
    const latest = (await announcements.getConfig(org))?.data;
    const next = {
      ...change(latest),
      revision: (latest as { revision?: unknown })?.revision,
    };
    try {
      await announcements.setConfig(org, next);
      return next;
    } catch (error: any) {
      if (error?.response?.status !== 409) throw error;
      if (attempt >= MAX_SAVE_ATTEMPTS) throw new AnnouncementConflictError();
    }
  }
}

/** The stored index named by a route query value, or null when it is absent or not an integer. */
export function parseIndexQuery(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}
