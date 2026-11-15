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

// Every card's markdown is bundled here, so only the pages that show the logos import it;
// the router builds its AI routes from `aiCategories` and stays free of it.

import { getAICardLogos, resolveAICardLogo } from "./content";
import { manifestIntegrations } from "./content/manifest";
import { aiCategories, type AICategory, type AIIntegration } from "./data";

const manifestBySlug = new Map(manifestIntegrations.map((entry) => [entry.slug, entry] as const));

// Logo precedence: the manifest entry, then the card's frontmatter (one `logo:` in the md shows in
// the sidebar and the card hero), then the catalog's own.
const withCardLogo = (integration: AIIntegration): AIIntegration => {
  const entry = integration.contentSlug ? manifestBySlug.get(integration.contentSlug) : undefined;
  if (!entry) return integration;
  const card = getAICardLogos(entry.slug);
  return {
    ...integration,
    logo: resolveAICardLogo(entry.slug, entry.logo) || card.logo || integration.logo,
    logoDark:
      resolveAICardLogo(entry.slug, entry.logoDark ?? (entry as any).logo_dark) ||
      card.logoDark ||
      integration.logoDark,
  };
};

/** `aiCategories` with each content card's brand logo resolved. */
export const aiCategoriesWithLogos: AICategory[] = aiCategories.map((category) => ({
  slug: category.slug,
  // Forwarded, not read, so the label follows the locale rather than the one loaded at import.
  get name() {
    return category.name;
  },
  integrations: category.integrations.map(withCardLogo),
}));
