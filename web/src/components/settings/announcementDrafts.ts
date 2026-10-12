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

/** The form model behind the banner editor, and its round trip to the JSON the API stores. */

import {
  DEFAULT_TEXT_SIZE,
  isBannerIcon,
  isHexColor,
  isTextSize,
  type BannerTextSize,
} from "@/utils/announcementAppearance";
import type { BannerVariantName } from "@/utils/announcementOrder";

export type BannerStart = "now" | "at";

/** `after` is a span counted from the start, which the server pins to an absolute end on save. */
export type BannerEnd = "never" | "after" | "at";

export interface BannerLink {
  text: string;
  url: string;
}

/** One banner as the form holds it. Flat and all-strings, so fields bind directly. */
export interface BannerDraft {
  /** Dismissal key. Preserved when present so editing text does not re-show it. */
  id: string;
  message: string;
  variant: BannerVariantName;
  start: BannerStart;
  /** `datetime-local` value in the author's own zone, when `start` is `at`. */
  startsAt: string;
  end: BannerEnd;
  /** A span like "4h", when `end` is `after`. */
  duration: string;
  /** `datetime-local` value in the author's own zone, when `end` is `at`. */
  endsAt: string;
  dismissible: boolean;
  links: BannerLink[];
  /** Empty means every organization. */
  orgs: string[];
  textSize: BannerTextSize;
  /** `#RRGGBB` background per theme mode; empty keeps the severity's colours. */
  colorLight: string;
  colorDark: string;
  /** One of `BANNER_ICONS`; empty keeps the severity's icon. */
  icon: string;
  /** The saved style this banner's look was copied from, for labelling only. */
  styleId: string;
}

/** A saved custom look the editor copies into a banner; editing it later leaves banners alone. */
export interface BannerStyle {
  id: string;
  name: string;
  icon: string;
  textSize: BannerTextSize;
  colorLight: string;
  colorDark: string;
}

export const VARIANTS: BannerVariantName[] = ["info", "warning", "critical", "promo"];

/** More buttons than this crowd the message out of a bar on a laptop; the server holds the same cap. */
export const MAX_LINKS = 3;

export function emptyDraft(): BannerDraft {
  return {
    id: "",
    message: "",
    variant: "info",
    start: "now",
    startsAt: "",
    end: "never",
    duration: "4h",
    endsAt: "",
    dismissible: true,
    links: [],
    orgs: [],
    textSize: DEFAULT_TEXT_SIZE,
    colorLight: "",
    colorDark: "",
    icon: "",
    styleId: "",
  };
}

/** Whether the banner carries a look of its own rather than its severity's. */
export function hasCustomLook(
  draft: Pick<BannerDraft, "icon" | "textSize" | "colorLight" | "colorDark">,
): boolean {
  return (
    !!(draft.icon || draft.colorLight || draft.colorDark) || draft.textSize !== DEFAULT_TEXT_SIZE
  );
}

/** A fresh dismissal key, so a new or duplicated banner is never dismissed along with another. */
export function newBannerId(prefix = "banner"): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Largest first, as the API requires them in a compound span like `"1h30m"`. */
const DURATION_UNITS: [string, number][] = [
  ["y", 31_536_000_000],
  ["w", 604_800_000],
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1000],
  ["ms", 1],
];

const DURATION_PART = /(\d+)(ms|[ywdhms])/y;

/** Milliseconds in a span the API accepts (`"90m"`, `"1h30m"`, bare seconds), or null when it is not one. */
export function parseDurationMs(value: string): number | null {
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000 || null;

  DURATION_PART.lastIndex = 0;
  let total = 0;
  let consumed = 0;
  let previous = -1;
  let match: RegExpExecArray | null;
  while ((match = DURATION_PART.exec(text))) {
    const position = DURATION_UNITS.findIndex(([unit]) => unit === match![2]);
    if (position <= previous) return null;
    previous = position;
    consumed = DURATION_PART.lastIndex;
    total += Number(match[1]) * DURATION_UNITS[position][1];
  }
  return consumed === text.length && total ? total : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * An RFC 3339 instant as a `datetime-local` value in the viewer's own zone.
 *
 * The author picks a wall-clock time where they are sitting; showing them the
 * stored UTC offset instead would mean mentally converting a maintenance window.
 */
export function toLocalInput(value?: string | null): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * A `datetime-local` value as RFC 3339 carrying the browser's offset.
 *
 * The offset is what makes this safe to send: the API rejects a naive timestamp
 * rather than guessing a zone, so the picker has to supply one.
 */
export function toRfc3339(value: string): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  // getTimezoneOffset is minutes *behind* UTC, so the sign is inverted.
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** One authored banner, as loose as it arrives from the API. */
export interface AuthoredBanner {
  message?: unknown;
  id?: unknown;
  variant?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  duration?: unknown;
  dismissible?: unknown;
  cta?: { text?: unknown; url?: unknown } | null;
  ctas?: unknown;
  orgs?: unknown;
  text_size?: unknown;
  colors?: { light?: unknown; dark?: unknown } | null;
  icon?: unknown;
  style?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function linksFromAuthored(banner: AuthoredBanner): BannerLink[] {
  const authored = Array.isArray(banner.ctas) ? banner.ctas : banner.cta ? [banner.cta] : [];
  return authored
    .filter((cta): cta is Record<string, unknown> => typeof cta === "object" && cta !== null)
    .map((cta) => ({ text: str(cta.text), url: str(cta.url) }))
    .filter((link) => link.text);
}

export function draftFromAuthored(banner: AuthoredBanner): BannerDraft {
  const draft = emptyDraft();

  draft.id = str(banner.id);
  draft.message = str(banner.message);

  const variant = str(banner.variant) as BannerVariantName;
  if (VARIANTS.includes(variant)) draft.variant = variant;

  draft.startsAt = toLocalInput(str(banner.starts_at));
  if (draft.startsAt) draft.start = "at";

  draft.endsAt = toLocalInput(str(banner.ends_at));
  const duration = str(banner.duration);
  if (draft.endsAt) {
    draft.end = "at";
  } else if (parseDurationMs(duration)) {
    draft.end = "after";
    draft.duration = duration;
  }

  if (typeof banner.dismissible === "boolean") draft.dismissible = banner.dismissible;
  draft.links = linksFromAuthored(banner);

  if (Array.isArray(banner.orgs)) {
    draft.orgs = banner.orgs.filter((org): org is string => typeof org === "string");
  }

  if (isTextSize(banner.text_size)) draft.textSize = banner.text_size;

  // An unreadable colour falls back to the severity's own rather than blocking the edit.
  const light = banner.colors?.light;
  const dark = banner.colors?.dark;
  if (isHexColor(light)) draft.colorLight = light;
  if (isHexColor(dark)) draft.colorDark = dark;

  if (isBannerIcon(banner.icon)) draft.icon = banner.icon;
  draft.styleId = str(banner.style);

  return draft;
}

/** Drafts for every banner in a parsed config; entries without a message are dropped. */
export function draftsFromConfig(parsed: unknown): BannerDraft[] {
  const banners = (parsed as { banners?: unknown } | null)?.banners;
  if (!Array.isArray(banners)) return [];

  return banners
    .filter((banner): banner is AuthoredBanner => typeof banner === "object" && banner !== null)
    .filter((banner) => str(banner.message).trim())
    .map(draftFromAuthored);
}

/** Every banner key this editor writes; any other key on a stored banner is carried through untouched. */
const EDITED_KEYS = new Set([
  "message",
  "id",
  "variant",
  "starts_at",
  "ends_at",
  "duration",
  "dismissible",
  "cta",
  "ctas",
  "orgs",
  "text_size",
  "colors",
  "icon",
  "style",
]);

/** The stored instant when the picker still shows it, so a minute-precision input does not move it. */
function keptInstant(stored: unknown, local: string): string {
  return typeof stored === "string" && toLocalInput(stored) === local ? stored : toRfc3339(local);
}

/** One draft as authored JSON, with defaults left out so the stored config stays short. */
export function authoredFromDraft(
  draft: BannerDraft,
  stored: Record<string, unknown> = {},
): Record<string, unknown> {
  const banner: Record<string, unknown> = Object.fromEntries(
    Object.entries(stored).filter(([key]) => !EDITED_KEYS.has(key)),
  );
  banner.message = draft.message.trim();

  if (draft.id.trim()) banner.id = draft.id.trim();
  if (draft.variant !== "info") banner.variant = draft.variant;

  if (draft.start === "at" && draft.startsAt) {
    banner.starts_at = keptInstant(stored.starts_at, draft.startsAt);
  }
  if (draft.end === "after" && parseDurationMs(draft.duration)) {
    banner.duration = draft.duration.trim();
  }
  if (draft.end === "at" && draft.endsAt)
    banner.ends_at = keptInstant(stored.ends_at, draft.endsAt);

  if (!draft.dismissible) banner.dismissible = false;

  const links = draft.links
    .map((link) => ({ text: link.text.trim(), url: link.url.trim() }))
    .filter((link) => link.text && link.url);
  if (links.length) {
    banner.ctas = links;
    // The API accepts the first button mirrored here, which a server or UI that predates `ctas` keeps on save.
    banner.cta = links[0];
  }

  if (draft.orgs.length) banner.orgs = [...draft.orgs];

  if (draft.textSize !== DEFAULT_TEXT_SIZE) banner.text_size = draft.textSize;

  const colors: Record<string, string> = {};
  if (draft.colorLight) colors.light = draft.colorLight.toUpperCase();
  if (draft.colorDark) colors.dark = draft.colorDark.toUpperCase();
  if (Object.keys(colors).length) banner.colors = colors;

  if (draft.icon) banner.icon = draft.icon;
  if (draft.styleId) banner.style = draft.styleId;

  return banner;
}

/** Where a banner is in its display window, judged against the viewer's clock. */
export type BannerStatus = "live" | "scheduled" | "ended";

// A span with no explicit start is anchored to whenever the server last read it, so it is treated as open-ended.
function endMs(draft: BannerDraft, start: number | null): number | null {
  if (draft.end === "at" && draft.endsAt) return new Date(draft.endsAt).getTime();
  const span = draft.end === "after" ? parseDurationMs(draft.duration) : null;
  return span !== null && start !== null ? start + span : null;
}

export function bannerStatus(draft: BannerDraft, now: number = Date.now()): BannerStatus {
  const start = draft.start === "at" && draft.startsAt ? new Date(draft.startsAt).getTime() : null;
  const end = endMs(draft, start);

  if (start !== null && now < start) return "scheduled";
  if (end !== null && now >= end) return "ended";
  return "live";
}

/** A promotion every one of whose organizations also sees a live critical banner, so it never shows. */
export function isHiddenByCritical(
  draft: BannerDraft,
  others: BannerDraft[],
  now: number = Date.now(),
): boolean {
  if (draft.variant !== "promo") return false;

  const critical = others.filter(
    (d) => d.variant === "critical" && bannerStatus(d, now) === "live",
  );
  if (critical.some((d) => !d.orgs.length)) return true;
  if (!critical.length || !draft.orgs.length) return false;

  const covered = new Set(critical.flatMap((d) => d.orgs));
  return draft.orgs.every((org) => covered.has(org));
}

/** A stored banner without its label pointing at `styleId`, which is about to be deleted. */
export function withoutStyle(
  banner: Record<string, unknown>,
  styleId: string,
): Record<string, unknown> {
  if (banner.style !== styleId) return banner;
  const { style: _style, ...rest } = banner;
  return rest;
}

export function stylesFromConfig(parsed: unknown): BannerStyle[] {
  const styles = (parsed as { styles?: unknown } | null)?.styles;
  if (!Array.isArray(styles)) return [];

  return styles
    .filter((style): style is Record<string, any> => typeof style === "object" && style !== null)
    .filter((style) => str(style.id) && str(style.name))
    .map((style) => ({
      id: str(style.id),
      name: str(style.name),
      icon: isBannerIcon(style.icon) ? style.icon : "",
      textSize: isTextSize(style.text_size) ? style.text_size : DEFAULT_TEXT_SIZE,
      colorLight: isHexColor(style.colors?.light) ? style.colors.light : "",
      colorDark: isHexColor(style.colors?.dark) ? style.colors.dark : "",
    }));
}

export function authoredFromStyle(style: BannerStyle): Record<string, unknown> {
  const authored: Record<string, unknown> = { id: style.id, name: style.name.trim() };
  if (style.icon) authored.icon = style.icon;
  if (style.textSize !== DEFAULT_TEXT_SIZE) authored.text_size = style.textSize;

  const colors: Record<string, string> = {};
  if (style.colorLight) colors.light = style.colorLight.toUpperCase();
  if (style.colorDark) colors.dark = style.colorDark.toUpperCase();
  if (Object.keys(colors).length) authored.colors = colors;

  return authored;
}
