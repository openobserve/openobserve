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

import type { LocationQuery, LocationQueryValue } from "vue-router";
import { generateDurationLabel, parseDuration } from "@/utils/date";
import { isFitEnabled, parseKioskTheme, type KioskThemeChoice } from "@/utils/dashboard/kiosk";

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

export interface PlaylistEntry {
  dashboardId: string;
  folderId: string;
}

/** A playlist row in the setup dialog; names are filled in when known. */
export interface PlaylistDialogEntry extends PlaylistEntry {
  title?: string | null;
  folderName?: string | null;
}

export interface PlaylistConfig {
  org: string;
  entries: PlaylistEntry[];
  intervalSeconds: number;
  /** 0-based slide to start on. */
  slideIndex: number;
  /** Relative range such as `1h`; null keeps each dashboard's own default range. */
  period: string | null;
  theme: KioskThemeChoice;
  fit: boolean;
  timezone: string | null;
}

export const PLAYLIST_MAX_ENTRIES = 50;
export const PLAYLIST_DEFAULT_INTERVAL_SECONDS = 60;
export const PLAYLIST_MIN_INTERVAL_SECONDS = 10;
export const PLAYLIST_MAX_INTERVAL_SECONDS = 3600;
/** Each frame refreshes itself at this pace, so a slide left on screen never goes stale. */
export const PLAYLIST_SLIDE_REFRESH_SECONDS = 300;
export const PLAYLIST_INTERVAL_CHOICES = [
  10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600,
] as const;
export const PLAYLIST_PERIOD_CHOICES = ["15m", "1h", "6h", "24h", "7d"] as const;

/** Every param the playlist adds to a dashboard URL; carried by the URL rewrite and removed on exit. */
export const PLAYLIST_PARAMS = [
  "playlist",
  "interval",
  "slide",
  "embed",
  "tvpage",
  "miss",
] as const;

export const PLAYLIST_TV_PATH = "/dashboards/tv";
export const PLAYLIST_VIEW_PATH = "/dashboards/view";

const PERIOD_PATTERN = /^\d+[smhdwM]$/;

const first = (value: QueryValue): string | undefined => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : undefined;
};

const decode = (part: string): string | null => {
  try {
    return decodeURIComponent(part).trim();
  } catch {
    return null;
  }
};

/** `<dash>:<folder>,…`; malformed, empty and duplicate entries are dropped and the list is capped. */
export const parsePlaylistEntries = (value: QueryValue): PlaylistEntry[] => {
  const raw = first(value);
  if (!raw) return [];
  const seen = new Set<string>();
  const entries: PlaylistEntry[] = [];
  for (const item of raw.split(",")) {
    if (entries.length >= PLAYLIST_MAX_ENTRIES) break;
    const at = item.indexOf(":");
    const dashboardId = decode(at === -1 ? item : item.slice(0, at));
    const folderId = at === -1 ? "default" : decode(item.slice(at + 1));
    if (!dashboardId || folderId === null) continue;
    const entry = { dashboardId, folderId: folderId || "default" };
    const key = `${entry.dashboardId}\u0000${entry.folderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
};

export const serializePlaylistEntries = (entries: PlaylistEntry[]): string =>
  entries
    .slice(0, PLAYLIST_MAX_ENTRIES)
    .map((e) => `${encodeURIComponent(e.dashboardId)}:${encodeURIComponent(e.folderId)}`)
    .join(",");

/** Seconds per slide, clamped to 10s–1h; missing or garbage falls back to 1m, never to "no rotation". */
export const parsePlaylistInterval = (value: QueryValue): number => {
  const raw = first(value);
  const seconds = raw ? parseDuration(raw) : 0;
  if (!seconds) return PLAYLIST_DEFAULT_INTERVAL_SECONDS;
  return Math.min(PLAYLIST_MAX_INTERVAL_SECONDS, Math.max(PLAYLIST_MIN_INTERVAL_SECONDS, seconds));
};

/** True when the link asked for an interval the player could not use as given. */
export const isPlaylistIntervalAdjusted = (value: QueryValue): boolean => {
  const raw = first(value);
  if (raw === undefined) return false;
  return parseDuration(raw) !== parsePlaylistInterval(raw);
};

/** 1-based `slide` to a 0-based index clamped into the list. */
export const parsePlaylistSlide = (value: QueryValue, count: number): number => {
  const n = Number.parseInt(first(value) ?? "", 10);
  if (!Number.isFinite(n) || count <= 0) return 0;
  return Math.min(count, Math.max(1, n)) - 1;
};

export const parsePlaylistPeriod = (value: QueryValue): string | null => {
  const raw = first(value);
  return raw && PERIOD_PATTERN.test(raw) ? raw : null;
};

/** The playlist a URL describes, or null when it names no dashboard. */
export const parsePlaylistQuery = (query: LocationQuery): PlaylistConfig | null => {
  const entries = parsePlaylistEntries(query.playlist);
  if (!entries.length) return null;
  return {
    org: first(query.org_identifier) ?? "",
    entries,
    intervalSeconds: parsePlaylistInterval(query.interval),
    slideIndex: parsePlaylistSlide(query.slide, entries.length),
    period: parsePlaylistPeriod(query.period),
    theme: parseKioskTheme(query.theme) ?? "current",
    fit: isFitEnabled(query.fit),
    timezone: first(query.timezone) ?? null,
  };
};

const sharedSlideParams = (config: PlaylistConfig): Record<string, string> => {
  const out: Record<string, string> = {};
  if (config.period) out.period = config.period;
  const forcedTheme = parseKioskTheme(config.theme);
  if (forcedTheme) out.theme = forcedTheme;
  if (config.fit) out.fit = "true";
  if (config.timezone) out.timezone = config.timezone;
  return out;
};

export const buildPlaylistQuery = (config: PlaylistConfig): Record<string, string> => ({
  ...(config.org ? { org_identifier: config.org } : {}),
  playlist: serializePlaylistEntries(config.entries),
  interval: generateDurationLabel(config.intervalSeconds),
  slide: String(config.slideIndex + 1),
  ...sharedSlideParams(config),
});

/** Kiosk URL of one slide; no `var-*` or `tab`, so each dashboard opens on its own defaults. */
export const buildSlideQuery = (
  config: PlaylistConfig,
  index: number,
  mode: "frame" | "page",
  misses = 0,
): Record<string, string> => {
  const entry = config.entries[index];
  const base: Record<string, string> = {
    ...(config.org ? { org_identifier: config.org } : {}),
    dashboard: entry.dashboardId,
    folder: entry.folderId,
    kiosk: "true",
    refresh: generateDurationLabel(PLAYLIST_SLIDE_REFRESH_SECONDS),
    ...sharedSlideParams(config),
  };
  if (mode === "frame") return { ...base, embed: "true" };
  const page: Record<string, string> = {
    ...base,
    ...buildPlaylistQuery({ ...config, slideIndex: index }),
    tvpage: "1",
  };
  if (misses > 0) page.miss = String(misses);
  return page;
};

export const isPlaylistEmbed = (query: LocationQuery): boolean => first(query.embed) === "true";

export const isPlaylistPage = (query: LocationQuery): boolean => first(query.tvpage) === "1";

export const parsePlaylistMisses = (query: LocationQuery): number => {
  const n = Number.parseInt(first(query.miss) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const pickPlaylistParams = (query: LocationQuery): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of PLAYLIST_PARAMS) {
    const value = first(query[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
};

export const stripPlaylistParams = (query: LocationQuery): LocationQuery => {
  const next = { ...query };
  for (const key of PLAYLIST_PARAMS) delete next[key];
  return next;
};

export const PLAYLIST_MESSAGE_SOURCE = "o2-tv-playlist";

export type SlideHealthLevel = "ok" | "warn" | "bad";

export interface SlideHealthReport {
  level: SlideHealthLevel;
  failing: number;
  /** Backend unreachable: the player holds rotation instead of moving to another dead slide. */
  outage: boolean;
  lastSuccessAt: number | null;
}

export type PlaylistFrameMessage =
  | { source: typeof PLAYLIST_MESSAGE_SOURCE; type: "hello" }
  | { source: typeof PLAYLIST_MESSAGE_SOURCE; type: "ready"; title: string }
  | { source: typeof PLAYLIST_MESSAGE_SOURCE; type: "health"; health: SlideHealthReport }
  | { source: typeof PLAYLIST_MESSAGE_SOURCE; type: "missing"; reason: "notFound" | "forbidden" }
  | { source: typeof PLAYLIST_MESSAGE_SOURCE; type: "error" };

/** Shape check for a message posted by a slide frame; the origin check is the caller's. */
export const isPlaylistFrameMessage = (data: unknown): data is PlaylistFrameMessage => {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  if (msg.source !== PLAYLIST_MESSAGE_SOURCE) return false;
  switch (msg.type) {
    case "hello":
    case "error":
      return true;
    case "ready":
      return typeof msg.title === "string";
    case "missing":
      return msg.reason === "notFound" || msg.reason === "forbidden";
    case "health": {
      const h = msg.health as Record<string, unknown> | null;
      return (
        !!h &&
        (h.level === "ok" || h.level === "warn" || h.level === "bad") &&
        typeof h.failing === "number" &&
        typeof h.outage === "boolean"
      );
    }
    default:
      return false;
  }
};

/** 404 is deleted, 403 is no access; anything else is a load failure worth retrying. */
export const missingReasonFor = (status: unknown): "notFound" | "forbidden" | null => {
  if (status === 404) return "notFound";
  if (status === 403) return "forbidden";
  return null;
};

const directive = (csp: string, name: string): string[] | null => {
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/);
    if (tokens[0]?.toLowerCase() === name) return tokens.slice(1).map((t) => t.toLowerCase());
  }
  return null;
};

/** Whether these response headers forbid this app from framing its own pages. */
export const isFramingBlocked = (headers: Headers, origin: string): boolean => {
  const xfo = headers.get("x-frame-options")?.trim().toLowerCase();
  if (xfo && xfo !== "sameorigin") return true;
  const ancestors = directive(headers.get("content-security-policy") ?? "", "frame-ancestors");
  if (!ancestors) return false;
  if (ancestors.includes("'none'")) return true;
  return !ancestors.some(
    (source) => source === "'self'" || source === "*" || source === origin.toLowerCase(),
  );
};
