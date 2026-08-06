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

// Rich setup cards are entirely content-driven: an integration gets the rich,
// stepped card simply by having a `card:` + `detect:` YAML frontmatter block in
// its data-source-ui.md (see buildFromMarkdown.ts). No per-provider code and no
// list to maintain here — add frontmatter in the content repo and it lights up.

import type { CardSubstitutions, RichCardContent } from "@/components/ingestion/setupCard/types";
import { getAICardRaw } from "../index";
import { parseFrontmatter } from "./parseFrontmatter";
import { buildFromMarkdown } from "./buildFromMarkdown";

/** Whether an integration (by content slug) has a rich, frontmatter-driven card. */
export function hasRichCard(slug: string | undefined): boolean {
  if (!slug) return false;
  const md = getAICardRaw(slug);
  if (!md) return false;
  const { data } = parseFrontmatter(md);
  return !!(data?.detect && data?.card);
}

/** Build the rich card content for a slug, substituting per-org values. */
export function getRichCardContent(
  slug: string | undefined,
  subs: CardSubstitutions,
): RichCardContent | undefined {
  if (!slug) return undefined;
  const md = getAICardRaw(slug);
  if (!md) return undefined;
  return buildFromMarkdown(slug, md, subs) ?? undefined;
}
