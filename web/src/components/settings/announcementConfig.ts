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
 * Reading the announcement banner editor's buffer.
 *
 * Kept out of the component so the rules that decide what a given buffer means —
 * above all that an emptied editor clears every banner rather than failing to
 * parse — are stated and tested in one place.
 */

import { orderBanners } from "@/utils/announcementOrder";

/** What the editor opens on when nothing has been published yet. */
export const EMPTY_CONFIG = `{\n  "banners": []\n}`;

/**
 * Every field in one document, each banner showing a different way to schedule.
 *
 * Annotated with `//` comments, which [`stripJsonComments`] removes before the
 * config is parsed or published. Kept terse: the form covers authoring, so this
 * is a field reference for people who already know what they are looking for.
 */
export const EXAMPLE_CONFIG = `{
  "banners": [
    {
      // required
      "message": "Scheduled maintenance Sat 02:00-04:00 UTC.",
      // info | warning | critical | promo
      "variant": "warning",
      // RFC 3339, with an offset
      "starts_at": "2026-08-09T00:00:00Z",
      "ends_at": "2026-08-12T04:00:00Z",
      // http(s) only
      "cta": { "text": "Status page", "url": "https://status.example.com" }
    },
    {
      // dismissal key — omit to derive it from the message
      "id": "read-only-window",
      "message": "We are in read-only mode while the migration finishes.",
      "variant": "critical",
      // instead of ends_at
      "duration": "1h",
      "dismissible": false
    },
    {
      "message": "Reminder: rotate your API keys before the end of the quarter.",
      // omit to show to every organization
      "orgs": ["acme", "acme-prod"]
    }
  ]
}`;

/**
 * Drop `//` and block comments from a JSONC buffer.
 *
 * String-aware on purpose: every CTA in this config holds a `https://…` URL, and
 * a naive strip would cut each one down to `https:`.
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      // A backslash escapes the next character, so `\"` does not end the string.
      if (char === "\\") {
        out += char + (next ?? "");
        i++;
        continue;
      }
      if (char === '"') inString = false;
      out += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += char;
  }

  return out;
}

/** A banner as far as the preview cares. */
export interface PreviewBanner {
  message: string;
  variant?: string;
}

export type ParsedConfig = { ok: true; payload: unknown } | { ok: false };

/**
 * Interpret the editor buffer for saving.
 *
 * An empty (or whitespace-only) buffer is the obvious way to take every banner
 * down, so it means "no banners" rather than a parse error. Anything else must be
 * valid JSON once its comments are removed; the server does the real schema
 * validation.
 */
export function parseBannerConfig(buffer: string): ParsedConfig {
  const authored = stripJsonComments(buffer).trim();
  if (!authored) {
    return { ok: true, payload: { banners: [] } };
  }

  try {
    return { ok: true, payload: JSON.parse(authored) };
  } catch {
    return { ok: false };
  }
}

/**
 * Banners to show in the live preview, in the order the app would render them.
 *
 * Ordering goes through the same resolver the live bar uses — authored order is
 * not render order, and a preview that showed the JSON's sequence taught authors
 * the wrong thing about which banner lands on top.
 *
 * Best-effort by design: the buffer is mid-edit most of the time, so anything
 * unparseable or missing a message simply does not preview.
 */
export function previewBannersFrom(buffer: string): PreviewBanner[] {
  try {
    const parsed = JSON.parse(stripJsonComments(buffer));
    const banners = Array.isArray(parsed?.banners) ? parsed.banners : [];
    return orderBanners(
      banners.filter((banner: PreviewBanner) => typeof banner?.message === "string"),
    );
  } catch {
    return [];
  }
}
