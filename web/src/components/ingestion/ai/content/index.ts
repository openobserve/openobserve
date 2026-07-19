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

// Rich AI data-source card markdown, bundled at build time via Vite.
//
// (logo helpers below also parse frontmatter to surface the card logo to the menu)
//
// The markdown data lives under src/assets/ai-datasource-content/generated/,
// fetched by scripts/fetch-datasource-content.mjs before Vite starts. Builds
// fail if it can't be fetched (DS_CONTENT_STRICT), so there is no committed
// snapshot to keep in sync — the bundle always reflects the latest content.

import { parseFrontmatter } from "./richCard/parseFrontmatter";

const generatedModules = import.meta.glob(
  "@/assets/ai-datasource-content/generated/*/data-source-ui.md",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// Match the slug dir without requiring a leading slash — Vite's glob keys
// differ between dev and build, so anchor only on the file name.
const slugFromPath = (path: string): string | null => {
  const m = path.match(/([^/]+)\/data-source-ui\.md$/);
  return m ? m[1] : null;
};

const rawBySlug: Record<string, string> = {};
for (const [path, raw] of Object.entries(generatedModules)) {
  const slug = slugFromPath(path);
  if (slug) rawBySlug[slug] = raw;
}

/** Raw markdown for a content slug, or undefined if no rich content exists for it. */
export function getAICardRaw(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  return rawBySlug[slug];
}

// Logo assets co-located with each card (generated/<slug>/logo.svg etc.),
// bundled to hashed URLs by Vite. SVG preferred; PNG/WebP/JPG supported.
const logoModules = import.meta.glob(
  "@/assets/ai-datasource-content/generated/*/*.{svg,png,webp,jpg,jpeg}",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

const logosBySlug: Record<string, Record<string, string>> = {};
for (const [path, url] of Object.entries(logoModules)) {
  const m = path.match(/([^/]+)\/([^/]+)$/);
  if (!m) continue;
  (logosBySlug[m[1]] ??= {})[m[2]] = url;
}

/**
 * Resolve a logo reference to a usable <img> src.
 * - absolute `http(s)` URL → returned as-is (escape hatch)
 * - bare filename / relative path → the bundled asset from generated/<slug>/
 * - missing / not found → "" (caller falls back to the monogram)
 */
export function resolveAICardLogo(
  slug: string | undefined,
  logo: string | undefined,
): string {
  if (!logo) return "";
  if (/^https?:\/\//i.test(logo)) return logo;
  if (!slug) return "";
  const file = logo.replace(/^.*\//, ""); // basename
  return logosBySlug[slug]?.[file] ?? "";
}

/**
 * Resolved {logo, logoDark} from a card's frontmatter, so the sidebar menu can
 * show the same logo as the hero from a single authoring spot (the md). A
 * manifest `logo` still takes precedence at the call site.
 */
export function getAICardLogos(slug: string | undefined): {
  logo?: string;
  logoDark?: string;
} {
  const md = getAICardRaw(slug);
  if (!md) return {};
  const card = (parseFrontmatter(md).data?.card ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) =>
    resolveAICardLogo(slug, typeof v === "string" ? v : undefined) || undefined;
  return { logo: pick(card.logo), logoDark: pick(card.logo_dark) };
}

/** All content slugs that have rich cards (useful for tests/debugging). */
export function availableCardSlugs(): string[] {
  return Object.keys(rawBySlug).sort();
}
