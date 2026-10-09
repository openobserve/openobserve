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

/**
 * The form model behind the banner builder, and its translation to and from the
 * authored JSON the API stores.
 *
 * Kept out of the components so the round-trip — the part that quietly loses an
 * author's work when it is wrong — is stated and tested in one place.
 */

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
  /** Background hex per theme mode; empty means the variant's own fill. */
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

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Milliseconds in a span like `"90m"`, or null when it is not one. */
export function parseDurationMs(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([smhdw])\s*$/i.exec(value);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = DURATION_UNIT_MS[match[2].toLowerCase()];
  if (!amount || !unit) return null;

  return amount * unit;
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

/** A date as RFC 3339 in the browser's offset; the API rejects a naive timestamp. */
export function formatRfc3339(date: Date): string {
  // getTimezoneOffset is minutes *behind* UTC, so the sign is inverted.
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** A `datetime-local` value as RFC 3339 carrying the browser's offset. */
export function toRfc3339(value: string): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return formatRfc3339(date);
}

/** One authored banner, as loose as it arrives from the API. */
interface AuthoredBanner {
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

  const colors = banner.colors;
  if (colors && typeof colors === "object") {
    if (isHexColor(colors.light)) draft.colorLight = colors.light.toUpperCase();
    if (isHexColor(colors.dark)) draft.colorDark = colors.dark.toUpperCase();
  }

  if (isBannerIcon(banner.icon)) draft.icon = banner.icon;
  draft.styleId = str(banner.style);

  return draft;
}

/** A stored banner's draft, keyed by its position in the stored list. */
export interface IndexedDraft {
  index: number;
  draft: BannerDraft;
  /** The stored object as loaded, so a write can detect that someone else changed it. */
  raw: unknown;
}

/** The stored banner list, as loose as it arrives. */
export function rawBanners(parsed: unknown): unknown[] {
  const banners = (parsed as { banners?: unknown } | null)?.banners;
  return Array.isArray(banners) ? banners : [];
}

/** Drafts for every usable banner, keeping the stored index so edits address the right entry. */
export function indexedDraftsFromConfig(parsed: unknown): IndexedDraft[] {
  return rawBanners(parsed).flatMap((banner, index) =>
    typeof banner === "object" && banner !== null && str((banner as AuthoredBanner).message).trim()
      ? [
          {
            index,
            draft: draftFromAuthored(banner as AuthoredBanner),
            raw: banner,
          },
        ]
      : [],
  );
}

/** Drafts for every banner in a parsed config; entries without a message are dropped. */
export function draftsFromConfig(parsed: unknown): BannerDraft[] {
  return indexedDraftsFromConfig(parsed).map((entry) => entry.draft);
}

/**
 * One draft as authored JSON.
 *
 * Defaults are omitted rather than written out, so the stored config stays the
 * short document a person would have written by hand.
 */
export function authoredFromDraft(draft: BannerDraft): Record<string, unknown> {
  const banner: Record<string, unknown> = { message: draft.message.trim() };

  if (draft.id.trim()) banner.id = draft.id.trim();
  if (draft.variant !== "info") banner.variant = draft.variant;

  if (draft.start === "at" && draft.startsAt) banner.starts_at = toRfc3339(draft.startsAt);
  // The server pins this to an absolute `ends_at` on save, so later saves cannot restart it.
  if (draft.end === "after" && parseDurationMs(draft.duration)) {
    banner.duration = draft.duration.trim();
  }
  if (draft.end === "at" && draft.endsAt) banner.ends_at = toRfc3339(draft.endsAt);

  if (!draft.dismissible) banner.dismissible = false;

  const links = draft.links
    .map((link) => ({ text: link.text.trim(), url: link.url.trim() }))
    .filter((link) => link.text && link.url);
  if (links.length) banner.ctas = links;

  if (draft.orgs.length) banner.orgs = [...draft.orgs];

  if (draft.textSize !== DEFAULT_TEXT_SIZE) banner.text_size = draft.textSize;

  const colors: Record<string, string> = {};
  if (isHexColor(draft.colorLight)) colors.light = draft.colorLight.toUpperCase();
  if (isHexColor(draft.colorDark)) colors.dark = draft.colorDark.toUpperCase();
  if (Object.keys(colors).length) banner.colors = colors;

  if (draft.icon) banner.icon = draft.icon;
  if (draft.styleId) banner.style = draft.styleId;

  return banner;
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
      colorLight: isHexColor(style.colors?.light) ? style.colors.light.toUpperCase() : "",
      colorDark: isHexColor(style.colors?.dark) ? style.colors.dark.toUpperCase() : "",
    }));
}

export function authoredFromStyle(style: BannerStyle): Record<string, unknown> {
  const authored: Record<string, unknown> = { id: style.id, name: style.name.trim() };
  if (style.icon) authored.icon = style.icon;
  if (style.textSize !== DEFAULT_TEXT_SIZE) authored.text_size = style.textSize;

  const colors: Record<string, string> = {};
  if (isHexColor(style.colorLight)) colors.light = style.colorLight.toUpperCase();
  if (isHexColor(style.colorDark)) colors.dark = style.colorDark.toUpperCase();
  if (Object.keys(colors).length) authored.colors = colors;

  return authored;
}

export interface PreviewBanner {
  message: string;
  variant: BannerVariantName;
  dismissible: boolean;
  ctas: BannerLink[];
  text_size: BannerTextSize;
  colors: { light: string; dark: string };
  icon: string;
}

export function previewFromDraft(draft: BannerDraft): PreviewBanner {
  return {
    message: draft.message,
    variant: draft.variant,
    dismissible: draft.dismissible,
    ctas: draft.links.filter((link) => link.text.trim()),
    text_size: draft.textSize,
    colors: { light: draft.colorLight, dark: draft.colorDark },
    icon: draft.icon,
  };
}
