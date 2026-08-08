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

import type { BannerVariantName } from "@/utils/announcementOrder";

/**
 * How an author describes when a banner shows. The three cases the form offers
 * cover every window the API accepts; a JSON-authored `starts_at` + `duration`
 * pair is folded into `window` on the way in.
 */
export type BannerSchedule = "always" | "duration" | "window";

/** One banner as the form holds it. Flat and all-strings, so fields bind directly. */
export interface BannerDraft {
  /** Dismissal key. Preserved when present so editing text does not re-show it. */
  id: string;
  message: string;
  variant: BannerVariantName;
  schedule: BannerSchedule;
  /** A span like "1h", when `schedule` is `duration`. */
  duration: string;
  /** `datetime-local` values in the author's own zone, when `schedule` is `window`. */
  startsAt: string;
  endsAt: string;
  dismissible: boolean;
  hasCta: boolean;
  ctaText: string;
  ctaUrl: string;
  /** Empty means every organization. */
  orgs: string[];
}

export const VARIANTS: BannerVariantName[] = ["info", "warning", "critical", "promo"];

export function emptyDraft(): BannerDraft {
  return {
    id: "",
    message: "",
    variant: "info",
    schedule: "always",
    duration: "1h",
    startsAt: "",
    endsAt: "",
    dismissible: true,
    hasCta: false,
    ctaText: "",
    ctaUrl: "",
    orgs: [],
  };
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
interface AuthoredBanner {
  message?: unknown;
  id?: unknown;
  variant?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  duration?: unknown;
  dismissible?: unknown;
  cta?: { text?: unknown; url?: unknown } | null;
  orgs?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function draftFromAuthored(banner: AuthoredBanner): BannerDraft {
  const draft = emptyDraft();

  draft.id = str(banner.id);
  draft.message = str(banner.message);

  const variant = str(banner.variant) as BannerVariantName;
  if (VARIANTS.includes(variant)) draft.variant = variant;

  draft.startsAt = toLocalInput(str(banner.starts_at));
  draft.endsAt = toLocalInput(str(banner.ends_at));

  const duration = str(banner.duration);
  if (draft.startsAt && duration && !draft.endsAt) {
    // `starts_at` + `duration` is a valid authored pair the form has no third
    // control for. Resolving it to an end instant keeps the window intact
    // instead of dropping one half of it.
    const durationMs = parseDurationMs(duration);
    if (durationMs) {
      draft.endsAt = toLocalInput(
        new Date(new Date(draft.startsAt).getTime() + durationMs).toISOString(),
      );
    }
  }

  if (draft.startsAt || draft.endsAt) {
    draft.schedule = "window";
  } else if (duration) {
    draft.schedule = "duration";
    draft.duration = duration;
  }

  if (typeof banner.dismissible === "boolean") draft.dismissible = banner.dismissible;

  if (banner.cta && str(banner.cta.text)) {
    draft.hasCta = true;
    draft.ctaText = str(banner.cta.text);
    draft.ctaUrl = str(banner.cta.url);
  }

  if (Array.isArray(banner.orgs)) {
    draft.orgs = banner.orgs.filter((org): org is string => typeof org === "string");
  }

  return draft;
}

/**
 * Drafts for every banner in a parsed config. Entries without a message are
 * dropped — they cannot be saved anyway, and the API names them by index.
 */
export function draftsFromConfig(parsed: unknown): BannerDraft[] {
  const banners = (parsed as { banners?: unknown } | null)?.banners;
  if (!Array.isArray(banners)) return [];

  return banners
    .filter((banner): banner is AuthoredBanner => typeof banner === "object" && banner !== null)
    .filter((banner) => str(banner.message).trim())
    .map(draftFromAuthored);
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

  if (draft.schedule === "duration" && draft.duration.trim()) {
    banner.duration = draft.duration.trim();
  }
  if (draft.schedule === "window") {
    if (draft.startsAt) banner.starts_at = toRfc3339(draft.startsAt);
    if (draft.endsAt) banner.ends_at = toRfc3339(draft.endsAt);
  }

  if (!draft.dismissible) banner.dismissible = false;

  if (draft.hasCta && draft.ctaText.trim() && draft.ctaUrl.trim()) {
    banner.cta = { text: draft.ctaText.trim(), url: draft.ctaUrl.trim() };
  }

  if (draft.orgs.length) banner.orgs = [...draft.orgs];

  return banner;
}

export function configFromDrafts(drafts: BannerDraft[]): { banners: Record<string, unknown>[] } {
  return { banners: drafts.map(authoredFromDraft) };
}
