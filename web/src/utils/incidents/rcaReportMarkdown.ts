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

// A private Marked instance prevents report rendering from mutating global markdown behavior.

import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Only a bare fence of the same character and sufficient length can close a code block.
const createCodeFenceTracker = () => {
  let open: { char: string; length: number } | null = null;
  return (line: string): boolean => {
    const run = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!open) {
      // A backtick opener's info string cannot hold a backtick: that line is inline code.
      if (!run || (run[1].startsWith("`") && run[2].includes("`"))) return false;
      open = { char: run[1][0], length: run[1].length };
      return true;
    }
    if (run && run[1][0] === open.char && run[1].length >= open.length && !run[2].trim()) {
      open = null;
    }
    return true;
  };
};

// Some agent reports mark sections with a standalone bold line instead of `##`.
const promoteBoldLinesToHeadings = (content: string): string => {
  const isCode = createCodeFenceTracker();
  const lines = content.split("\n").map((text) => ({ text, prose: !isCode(text) }));
  // A report that already has sections uses its bold lines as sub-labels, not sections.
  if (lines.some((l) => l.prose && /^#{2,3}\s/.test(l.text))) return content;
  return lines
    .map(({ text, prose }, i) => {
      const prev = lines[i - 1]?.text.trim() ?? "";
      // A bold line glued to the line above is part of that paragraph or list.
      const startsBlock = prev === "" || /^([-*_])\1{2,}$/.test(prev);
      const match =
        prose && startsBlock
          ? text.match(
              /^(?:\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*|__([^_\s](?:[^_\n]*[^_\s])?)__)\s*:?\s*$/,
            )
          : null;
      if (!match) return text;
      return `## ${(match[1] ?? match[2] ?? "").replace(/:$/, "").trim()}`;
    })
    .join("\n");
};

// Up to three spaces of indent: four spaces or a tab make an indented code block.
const KEY_VALUE_ITEM = /^ {0,3}-\s+\*\*([^*]+)\*\*:\s*(.+)$/;

// Three or more consecutive "- **Key**: Value" items read better as a table.
const convertKeyValueListsToTables = (content: string): string => {
  const isCode = createCodeFenceTracker();
  const lines = content.split("\n").map((text) => {
    const match = isCode(text) ? null : text.trimEnd().match(KEY_VALUE_ITEM);
    return { text, item: match ? { key: match[1] ?? "", value: match[2] ?? "" } : null };
  });
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].item) {
      result.push(lines[i].text);
      i++;
      continue;
    }

    const cells: string[][] = [];
    let j = i;
    while (j < lines.length) {
      const item = lines[j].item;
      if (item) {
        cells.push([item.key, item.value]);
        j++;
      } else if (lines[j].text.trim() === "" && lines[j + 1]?.item) {
        // Allow one blank line within the list
        j++;
      } else {
        break;
      }
    }

    // Escape GFM pipes; leave lists with pre-escaped pipes unchanged to avoid corrupting their content.
    if (cells.length >= 3 && !cells.flat().some((text) => text.includes("\\|"))) {
      result.push("", "| Field | Value |", "|-------|-------|");
      cells.forEach((row) =>
        result.push(`| ${row.map((text) => text.replace(/\|/g, "\\|")).join(" | ")} |`),
      );
      result.push("");
    } else {
      result.push(...lines.slice(i, j).map((line) => line.text));
    }
    i = j;
  }

  return result.join("\n");
};

// RcaReportContent owns colors; renderer classes supply structure only.
const HEADING_CLASSES = [
  "rca-h1 font-bold text-lg text-center mb-4 pb-2 border-b-2",
  "rca-h2 font-bold text-lg mt-5 mb-3 rca-section-bg px-4 py-3 rounded-default border-s-4",
  "rca-h3 font-semibold text-base mt-4 mb-2",
  "rca-h4 font-semibold text-sm mt-3 mb-2",
];

const rcaMarked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    heading({ tokens, depth }: Tokens.Heading) {
      const body = this.parser.parseInline(tokens);
      // Real heading elements keep the outline for screen readers; h5 and h6 read as h4.
      const level = Math.min(depth, 4);
      return `<h${level} class="${HEADING_CLASSES[level - 1]}">${body}</h${level}>`;
    },
    code({ text }: Tokens.Code) {
      return `<div class="rca-code-block border rounded-default p-3 my-3 overflow-x-auto"><pre class="text-sm font-mono whitespace-pre m-0"><code>${escapeHtml(text)}</code></pre></div>`;
    },
    codespan({ text }: Tokens.Codespan) {
      return `<code class="rca-inline-code px-1.5 py-0.5 rounded-default text-sm font-mono">${escapeHtml(text)}</code>`;
    },
    // Model-written links are untrusted: show their destination without making them clickable.
    link({ href, text, tokens }: Tokens.Link) {
      if (text === href) return escapeHtml(href);
      return `${this.parser.parseInline(tokens)} (${escapeHtml(href)})`;
    },
    // Never load a model-chosen remote image: show its alt text instead.
    image({ text }: Tokens.Image) {
      return escapeHtml(text);
    },
    list(token: Tokens.List) {
      const body = token.items.map((item) => this.listitem(item)).join("");
      const tag = token.ordered ? "ol" : "ul";
      const classes = token.ordered
        ? "rca-ol ps-5 my-3 space-y-1.5 list-decimal"
        : "rca-ul ps-5 my-3 space-y-1.5 list-disc";
      return `<${tag} class="${classes}">${body}</${tag}>`;
    },
    listitem(item: Tokens.ListItem) {
      return `<li class="rca-list-item">${this.parser.parse(item.tokens)}</li>`;
    },
    table(token: Tokens.Table) {
      const header = token.header
        .map(
          (cell, i) =>
            `<th class="px-3 py-2 text-left font-semibold text-sm text-table-header-text border-b border-table-header-border ${i === 0 ? "rca-first-cell" : ""}">${this.parser.parseInline(cell.tokens)}</th>`,
        )
        .join("");
      const body = token.rows
        .map(
          (row) =>
            `<tr class="hover:bg-table-row-hover-bg">${row
              .map(
                (cell, i) =>
                  `<td class="px-3 py-2 text-sm border-b border-table-row-divider ${i === 0 ? "rca-first-cell" : ""}">${this.parser.parseInline(cell.tokens)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      return `<div class="rca-table-wrapper my-4 overflow-x-auto"><table class="rca-table w-full border border-table-header-border rounded-default"><thead class="bg-table-header-bg"><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
    blockquote({ tokens }: Tokens.Blockquote) {
      return `<blockquote class="rca-blockquote border-s-4 ps-4 py-2 my-3 italic">${this.parser.parse(tokens)}</blockquote>`;
    },
    paragraph({ tokens }: Tokens.Paragraph) {
      return `<p class="mb-3">${this.parser.parseInline(tokens)}</p>`;
    },
    strong({ tokens }: Tokens.Strong) {
      return `<strong class="font-semibold">${this.parser.parseInline(tokens)}</strong>`;
    },
    em({ tokens }: Tokens.Em) {
      return `<em class="italic">${this.parser.parseInline(tokens)}</em>`;
    },
    hr() {
      return `<hr class="my-4 border-t" />`;
    },
    // Escape model-written HTML so it cannot inject markup, styles or classes.
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
  },
});

// Allow only renderer-owned tags and attributes after raw HTML has been escaped.
const ALLOWED_TAGS =
  "div p h1 h2 h3 h4 ul ol li strong em del br code pre table thead tbody tr th td blockquote hr".split(
    " ",
  );
const ALLOWED_ATTR = ["class"];

const VERDICT_FENCE = "```";

/** Strip only legacy fenced verdict tails, not current report content. */
export const stripVerdictFence = (md: string): string => {
  let inVerdict = false;
  return md
    .split("\n")
    .filter((line) => {
      if (inVerdict) {
        if (line.trimStart().startsWith(VERDICT_FENCE)) inVerdict = false;
        return false;
      }
      const trimmed = line.trim();
      const info = trimmed.slice(VERDICT_FENCE.length).split(/\s+/).filter(Boolean);
      inVerdict =
        trimmed.startsWith(VERDICT_FENCE) &&
        info.length === 2 &&
        info[0] === "json" &&
        info[1] === "verdict";
      return !inVerdict;
    })
    .join("\n")
    .trim();
};

const prepare = (md: string): string => promoteBoldLinesToHeadings(stripVerdictFence(md));

/** Renders an agent report to sanitized HTML wrapped in `.rca-report-content`. */
export const renderRcaReport = (md: string): string => {
  const html = rcaMarked.parse(convertKeyValueListsToTables(prepare(md)), {
    async: false,
  }) as string;
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
  return `<div class="rca-report-content">${sanitized}</div>`;
};
