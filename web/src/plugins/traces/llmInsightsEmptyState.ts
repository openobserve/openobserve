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

// Which AI integration guides the LLM Insights empty state links to: the guides
// AI-docs visitors read most, and the one whose docs page the user came from.

import { aiCategories, type AIIntegration } from "@/components/ingestion/ai/data";

/** Route names of the guides AI-docs visitors read most, in the order the chips show. */
export const POPULAR_AI_INTEGRATION_ROUTES = [
  "ai-mcp-use",
  "ai-deepseek",
  "ai-google-gemini",
  "ai-claude-code",
  "ai-openai-python",
] as const;

export function aiIntegrationByRoute(routeName: string): AIIntegration | undefined {
  for (const category of aiCategories) {
    const hit = category.integrations.find((i) => i.routeName === routeName);
    if (hit) return hit;
  }
  return undefined;
}

const docsPath = (url: URL) => url.pathname.toLowerCase().replace(/\/+$/, "");

/**
 * The integration whose openobserve.ai docs page one of `referrers` is (or sits
 * under), checked in order; the deepest docs path wins within one referrer.
 * Undefined when none is an AI integration docs page.
 */
export function referredAiIntegration(
  referrers: readonly (string | null | undefined)[],
): AIIntegration | undefined {
  for (const referrer of referrers) {
    if (!referrer) continue;
    let url: URL;
    try {
      url = new URL(referrer);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (host !== "openobserve.ai" && !host.endsWith(".openobserve.ai")) continue;
    const path = docsPath(url);
    let best: { integration: AIIntegration; length: number } | undefined;
    for (const category of aiCategories) {
      for (const integration of category.integrations) {
        let guide: string;
        try {
          guide = docsPath(new URL(integration.docURL));
        } catch {
          continue;
        }
        if (path !== guide && !path.startsWith(`${guide}/`)) continue;
        if (!best || guide.length > best.length) best = { integration, length: guide.length };
      }
    }
    if (best) return best.integration;
  }
  return undefined;
}
