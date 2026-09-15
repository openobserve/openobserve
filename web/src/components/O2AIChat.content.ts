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

import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked, type MarkedOptions } from "marked";

// Register VRL as a JavaScript alias (type assertion)
hljs.registerLanguage("vrl", () => hljs.getLanguage("javascript") as any);

// Configure marked options with custom language support
const markedOptions = {
  breaks: true,
  gfm: true,
  langPrefix: "hljs language-",
  headerIds: false,
  mangle: false,
  sanitize: false, // Allow HTML in markdown
  highlight: (code: string, lang: string) => {
    if (lang === "vrl") {
      return hljs.highlight(code, { language: "javascript" }).value;
    }
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
} as MarkedOptions;

marked.setOptions(markedOptions);

const LANGUAGE_DISPLAY_NAMES: { [key: string]: string } = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  python: "Python",
  py: "Python",
  sql: "SQL",
  vrl: "VRL",
  json: "JSON",
  css: "CSS",
  scss: "SCSS",
  bash: "Bash",
  shell: "Shell",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
};

export interface RenderedBlock {
  type: string;
  language?: string;
  content: string;
  highlightedContent?: string;
}

export function renderMarkdown(content: any) {
  return marked.parse(content);
}

/** Converts `#`/`##` headers to bold-with-colon, leaving fenced code blocks untouched. */
export function filterMarkdownHeaders(content: string): string {
  // First, protect code blocks by temporarily replacing them
  const codeBlocks: string[] = [];
  let filtered = content.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `___CODE_BLOCK_${codeBlocks.length - 1}___`;
  });

  filtered = filtered.replace(/^## (.+)$/gm, "**$1:**");
  filtered = filtered.replace(/^# (.+)$/gm, "**$1:**");

  filtered = filtered.replace(/___CODE_BLOCK_(\d+)___/g, (_match, index) => {
    return codeBlocks[parseInt(index)];
  });

  return filtered;
}

// Process text block and return array of code/text blocks for rendering
export function processTextBlock(text: string): RenderedBlock[] {
  const filteredContent = filterMarkdownHeaders(text);
  const tokens = marked.lexer(filteredContent);
  const blocks: RenderedBlock[] = [];

  for (const token of tokens) {
    if (token.type === "code") {
      // Remove comments at the beginning of code blocks
      let codeText = token.text.trim();
      while (codeText.startsWith("--") || codeText.startsWith("//") || codeText.startsWith("#")) {
        codeText = codeText.split("\n").slice(1).join("\n").trim();
      }

      const highlightedContent =
        token.lang && hljs.getLanguage(token.lang)
          ? DOMPurify.sanitize(hljs.highlight(codeText, { language: token.lang }).value)
          : DOMPurify.sanitize(hljs.highlightAuto(codeText).value);

      blocks.push({
        type: "code",
        language: token.lang || "",
        content: codeText,
        highlightedContent,
      });
    } else {
      blocks.push({
        type: "text",
        content: marked.parser([token]),
      });
    }
  }

  return blocks;
}

export const processMessageContent = processTextBlock;

// Helper to format JSON with syntax highlighting
export function formatLogEntryContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const formatted = JSON.stringify(parsed, null, 2);
    const highlighted = formatted.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = "json-number";
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = "json-key";
          } else {
            cls = "json-string";
          }
        } else if (/true|false/.test(match)) {
          cls = "json-boolean";
        } else if (/null/.test(match)) {
          cls = "json-null";
        }
        return `<span class="${cls}">${match}</span>`;
      },
    );
    return DOMPurify.sanitize(highlighted);
  } catch {
    // Not JSON, return plain text with HTML escaping
    return DOMPurify.sanitize(
      content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\n/g, "<br>"),
    );
  }
}

// Helper to create a better preview of content
export function createPreview(content: string, maxLength: number = 40): string {
  let preview = content.trim();

  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      if (keys.length > 0) {
        const firstKeys = keys
          .slice(0, 3)
          .map((k) => {
            const val = parsed[k];
            if (typeof val === "string") {
              const truncatedVal = val.length > 8 ? val.substring(0, 8) + "..." : val;
              return k + ': "' + truncatedVal + '"';
            }
            return k + ": " + String(val).substring(0, 8);
          })
          .join(", ");
        const moreKeys = keys.length > 3 ? ", ..." : "";
        preview = "{" + firstKeys + moreKeys + "}";
      }
    }
  } catch {
    // Not JSON, use plain text preview
    preview = preview.replace(/\s+/g, " ");
  }

  if (preview.length > maxLength) {
    preview = preview.substring(0, maxLength) + "...";
  }

  return preview;
}

// Parse log entries from message content and maintain order
export function parseLogEntries(content: string) {
  const logEntryPattern = /--- (.+?) (?:\(lines (\d+)-(\d+)\) )?---\n([\s\S]*?)\n--- end ---/g;
  const orderedBlocks: any[] = [];
  let lastIndex = 0;
  let match;

  while ((match = logEntryPattern.exec(content)) !== null) {
    const [fullMatch, filename, lineStart, lineEnd, logContent] = match;
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      const textBefore = content.substring(lastIndex, matchIndex).trim();
      if (textBefore) {
        orderedBlocks.push({
          type: "text",
          text: textBefore,
        });
      }
    }

    orderedBlocks.push({
      type: "log_entry",
      filename,
      lineStart: lineStart ? parseInt(lineStart) : undefined,
      lineEnd: lineEnd ? parseInt(lineEnd) : undefined,
      content: logContent.trim(),
      preview: createPreview(logContent.trim(), 60),
    });

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < content.length) {
    const textAfter = content.substring(lastIndex).trim();
    if (textAfter) {
      orderedBlocks.push({
        type: "text",
        text: textAfter,
      });
    }
  }

  return orderedBlocks;
}

export function getLanguageDisplay(lang: string): string {
  return LANGUAGE_DISPLAY_NAMES[lang.toLowerCase()] || lang.toUpperCase();
}

export function processHtmlBlock(content: string): string {
  // Sanitize HTML to prevent XSS attacks
  const sanitized = DOMPurify.sanitize(content);
  return sanitized
    .replace(/<pre([^>]*)>/g, '<span class="generated-code-block"$1>')
    .replace(/<\/pre>/g, "</span>");
}
