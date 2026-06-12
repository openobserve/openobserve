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
// The markdown data lives under src/assets/ai-datasource-content/generated/,
// fetched by scripts/fetch-datasource-content.mjs before Vite starts. Builds
// fail if it can't be fetched (DS_CONTENT_STRICT), so there is no committed
// snapshot to keep in sync — the bundle always reflects the latest content.

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

/** All content slugs that have rich cards (useful for tests/debugging). */
export function availableCardSlugs(): string[] {
  return Object.keys(rawBySlug).sort();
}
