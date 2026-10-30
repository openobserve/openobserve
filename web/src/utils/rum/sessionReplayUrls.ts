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

const hasScheme = (url: string) => /^[a-z][a-z\d+.-]*:/i.test(url);

const resolveLinkHref = (node: any, pageHref: string) => {
  const href = node.attributes?.href;
  if (typeof href !== "string" || !href || hasScheme(href) || href.startsWith("#")) return;
  try {
    node.attributes.href = new URL(href, pageHref).href;
  } catch {
    // An unparsable page URL leaves the href as recorded.
  }
};

// The SDK keeps the raw href of a sheet still loading at snapshot time, and replayed it resolves against OpenObserve.
export const resolveRelativeLinks = (node: any, pageHref: unknown): void => {
  if (!node || typeof pageHref !== "string" || !/^https?:/i.test(pageHref)) return;
  if (node.type === 2 && node.tagName === "link") resolveLinkHref(node, pageHref);
  node.childNodes?.forEach((child: any) => resolveRelativeLinks(child, pageHref));
};
