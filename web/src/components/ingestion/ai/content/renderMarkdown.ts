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

// Splits a card section's markdown into ordered segments — prose (sanitized
// HTML) and top-level fenced code blocks. The user's {url}/{org}/{token} are
// substituted ONLY inside code blocks (the runnable commands); prose keeps the
// literal placeholders so the "Substitutions" explanation reads correctly and
// the base64 token isn't rendered across descriptive text. The component renders
// prose via v-html and renders code segments with <CodeBlock>, so code is
// returned as raw text rather than baked into the HTML.

import { Marked } from "marked";
import DOMPurify from "dompurify";
import type { CardSubstitutions } from "@/components/ingestion/setupCard/types";

// Re-exported from the shared setup-card module so existing
// `from ".../renderMarkdown"` importers (traces, chat, AI cards) keep working.
export type { CardSubstitutions } from "@/components/ingestion/setupCard/types";
export { safeHttpUrl } from "@/components/ingestion/setupCard/subs";

// One reusable parser for this module (a Marked instance is stateless across
// parse calls). Kept separate from the app-wide `marked` singleton so our
// options never leak into it.
const marked = new Marked({ gfm: true, breaks: false });

export type CardSegment =
  | { type: "html"; html: string }
  | { type: "code"; code: string; lang: string };

function substitute(md: string, subs: CardSubstitutions): string {
  return md
    .replaceAll("{url}", subs.url)
    .replaceAll("{org}", subs.org)
    .replaceAll("{token}", subs.token);
}

export function renderCardSegments(md: string, subs: CardSubstitutions): CardSegment[] {
  // Lex the RAW markdown. We substitute {url}/{org}/{token} ONLY inside code
  // blocks (the runnable commands), never in prose — so explanatory text like
  // the "Substitutions" list keeps the placeholder names, and the base64 token
  // isn't rendered across the prose.
  const tokens = marked.lexer(md);

  const segments: CardSegment[] = [];
  let buffer = "";

  // Render accumulated non-code markdown into one sanitized HTML segment.
  const flushProse = () => {
    if (!buffer.trim()) {
      buffer = "";
      return;
    }
    // `async: false` forces the sync string overload (no custom async tokens),
    // and DOMPurify guards the HTML we hand to v-html (XSS defense).
    const html = DOMPurify.sanitize(marked.parse(buffer, { async: false }));
    segments.push({ type: "html", html });
    buffer = "";
  };

  for (const token of tokens) {
    // Only TOP-LEVEL fenced code blocks become CopyContent blocks; code nested
    // inside lists/blockquotes stays inline in the prose.
    if (token.type === "code") {
      flushProse();
      segments.push({
        type: "code",
        code: substitute(token.text, subs), // real values only in runnable code
        lang: token.lang ?? "",
      });
    } else {
      buffer += token.raw;
    }
  }
  flushProse();

  return segments;
}
