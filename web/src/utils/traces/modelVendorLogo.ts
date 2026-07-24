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

// Maps a GenAI model node's name to a brand logo, reusing the same vendor logos
// the AI-integrations catalog ships (generated/<vendor>/logo.svg). This is what
// lets the agent graph render a model node (e.g. "gpt-4o", "claude-3-5-sonnet")
// with the OpenAI / Anthropic / Gemini mark instead of a generic chip icon —
// making provider mix readable at a glance. Falls back to the chip icon when the
// model doesn't match a known vendor.

// Vendor logos, inlined as base64 `data:` URIs (Vite `?inline`) rather than
// hashed URLs. The graph embeds these inside an SVG <image> that ECharts
// rasterizes to canvas — an EXTERNAL url there can render blank or taint the
// canvas, whereas a self-contained data: URI always renders. Light + dark
// variants are both captured so the graph can pick per theme.
const logoModules = import.meta.glob(
  "@/assets/ai-datasource-content/generated/*/*.{svg,png,webp,jpg,jpeg}",
  { query: "?inline", import: "default", eager: true },
) as Record<string, string>;

const logosBySlug: Record<string, { light?: string; dark?: string }> = {};
for (const [path, url] of Object.entries(logoModules)) {
  const m = path.match(/([^/]+)\/([^/]+)$/);
  if (!m) continue;
  const [, slug, file] = m;
  const bucket = (logosBySlug[slug] ??= {});
  if (/^dark-logo\./i.test(file)) bucket.dark = url;
  else if (/^logo\./i.test(file)) bucket.light = url;
}

/**
 * Ordered model-name → vendor-slug rules. First match wins, so more specific
 * patterns precede generic ones. Slugs correspond to folders under
 * `generated/<slug>/` that carry a `logo.*`.
 */
const MODEL_VENDOR_RULES: Array<{ re: RegExp; slug: string }> = [
  { re: /(^|[^a-z])(gpt|o1|o3|o4|davinci|text-embedding|dall-?e|whisper)/i, slug: "openai" },
  { re: /claude|anthropic/i, slug: "anthropic" },
  { re: /gemini|palm|bison|gemma|vertex/i, slug: "gemini" },
  { re: /mistral|mixtral|codestral/i, slug: "mistral" },
  { re: /llama|meta-/i, slug: "litellm" }, // no dedicated meta logo; litellm proxies these
  { re: /command|cohere/i, slug: "openrouter" },
];

/**
 * Map a model name to its vendor slug (folder under `generated/<slug>/`), or
 * `undefined` if no rule matches. Pure name→slug logic with no dependency on the
 * logo assets — so it is deterministically testable even when the (gitignored,
 * fetched-at-build) logo files are absent.
 */
export function modelVendorSlug(modelName: string | undefined): string | undefined {
  if (!modelName) return undefined;
  // Strip a provider prefix like "anthropic/claude-3-5" or "openai/gpt-4o".
  const bare = modelName.includes("/")
    ? modelName.slice(modelName.lastIndexOf("/") + 1)
    : modelName;
  const probe = `${modelName} ${bare}`;
  return MODEL_VENDOR_RULES.find(({ re }) => re.test(probe))?.slug;
}

/**
 * Resolve a model name to a bundled vendor-logo `data:` URL. Returns "" when the
 * model matches no vendor rule OR the matched vendor's logo asset is not present
 * (the `generated/` assets are gitignored and fetched at build time, so callers
 * must treat "" as "no logo — use the chip-icon fallback"). `isDark` picks the
 * dark-mode variant when the vendor ships one.
 */
export function resolveModelVendorLogo(modelName: string | undefined, isDark = false): string {
  const slug = modelVendorSlug(modelName);
  if (!slug) return "";
  const b = logosBySlug[slug];
  if (!b) return "";
  return (isDark ? b.dark || b.light : b.light || b.dark) ?? "";
}
