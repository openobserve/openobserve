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
import { marked } from "marked";

import type { ChatMessage } from "@/ts/interfaces/chat";
import type { TranslateFn } from "@/types/i18n";
import { UNAUTHORIZED_MESSAGE_KEY } from "@/utils/authErrors";

// Register VRL as a JavaScript alias (type assertion)
hljs.registerLanguage("vrl", () => hljs.getLanguage("javascript") as any);

// Highlighting and sanitizing happen in processTextBlock and processHtmlBlock, not in marked.
marked.setOptions({ breaks: true, gfm: true });

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
      const codeText = token.text.trim();

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

/** A log entry as highlighted JSON or escaped text; `strict` for read-only views of other people's chats. */
export function formatLogEntryContent(content: string, strict = false): string {
  const sanitize = (html: string) => (strict ? sanitizeStrict(html) : DOMPurify.sanitize(html));
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
    return sanitize(highlighted);
  } catch {
    // Not JSON, return plain text with HTML escaping
    return sanitize(
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

/** Display text for a failed chat turn; a 403 status wins over any message. */
export function chatErrorMessage(error: any, t: TranslateFn): string {
  if (error.status === 403) {
    return t(UNAUTHORIZED_MESSAGE_KEY);
  } else if (error.message && error.message !== "No response body") {
    return error.message;
  } else {
    return t("aiAssistant.aiChat.serverResponseError");
  }
}

// Read-only views render other people's chats: only the markup markdown produces, nothing interactive or remote.
const STRICT_PURIFY = {
  ALLOWED_TAGS: [
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "class", "colspan", "rowspan", "align", "start"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

const SHARED_LINK_REL = "noopener noreferrer nofollow";

/** Sanitize with the read-only profile: inline (data:) images only, no styles, links that leak nothing. */
export function sanitizeStrict(content: string): string {
  const fragment = DOMPurify.sanitize(content, { ...STRICT_PURIFY, RETURN_DOM_FRAGMENT: true });
  fragment.querySelectorAll("img").forEach((img) => {
    if (!/^data:image\//i.test(img.getAttribute("src") ?? "")) img.remove();
  });
  fragment.querySelectorAll("a").forEach((link) => {
    link.setAttribute("rel", SHARED_LINK_REL);
    link.setAttribute("target", "_blank");
  });
  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

export function processHtmlBlock(content: string, strict = false): string {
  // Sanitize HTML to prevent XSS attacks
  const sanitized = strict ? sanitizeStrict(content) : DOMPurify.sanitize(content);
  return sanitized
    .replace(/<pre([^>]*)>/g, '<span class="generated-code-block"$1>')
    .replace(/<\/pre>/g, "</span>");
}

/** A chat message prepared for `O2AIChatMessage`: markdown blocks plus inline log entries. */
export function processChatMessage(message: ChatMessage) {
  if (message.role === "user") {
    const orderedBlocks = parseLogEntries(message.content);
    return {
      ...message,
      blocks: orderedBlocks.length > 0 ? [] : processMessageContent(message.content),
      contentBlocks:
        orderedBlocks.length > 0
          ? [...orderedBlocks, ...(message.contentBlocks || [])]
          : message.contentBlocks || [],
    };
  }
  return {
    ...message,
    blocks: processMessageContent(message.content),
    contentBlocks: message.contentBlocks || [],
  };
}
