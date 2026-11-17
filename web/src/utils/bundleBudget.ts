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

export const FORBIDDEN_ENTRY_CHUNKS = ["monaco-editor", "highlight.js", "gridstack", "echarts"];

export interface BundleBudgetResult {
  assets: string[];
  forbidden: string[];
  gzipBytes: number;
  overBudget: boolean;
}

// Assets the browser fetches before the app can render: module scripts, modulepreloads and stylesheets.
export function entryAssets(html: string): string[] {
  const assets = new Set<string>();
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag) && /type=["']module["']/i.test(tag);
    const isPreload = /rel=["']modulepreload["']/i.test(tag);
    const isStyle = /rel=["']stylesheet["']/i.test(tag);
    if (!isScript && !isPreload && !isStyle) continue;
    const src = tag.match(/(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (src) assets.add(src);
  }
  return [...assets];
}

export function checkBundleBudget(
  html: string,
  gzipSizeOf: (asset: string) => number,
  budgetBytes: number,
): BundleBudgetResult {
  const assets = entryAssets(html);
  const forbidden = assets.filter((asset) =>
    FORBIDDEN_ENTRY_CHUNKS.some((name) => asset.includes(name)),
  );
  const gzipBytes = assets.reduce((sum, asset) => sum + gzipSizeOf(asset), 0);
  return { assets, forbidden, gzipBytes, overBudget: gzipBytes > budgetBytes };
}
