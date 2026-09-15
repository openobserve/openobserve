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

import { describe, expect, it } from "vitest";

import {
  createPreview,
  filterMarkdownHeaders,
  formatLogEntryContent,
  getLanguageDisplay,
  parseLogEntries,
  processHtmlBlock,
  processMessageContent,
  processTextBlock,
  renderMarkdown,
} from "@/components/O2AIChat.content";

describe("filterMarkdownHeaders", () => {
  it("turns h1 and h2 into bold-with-colon", () => {
    expect(filterMarkdownHeaders("# One\n## Two")).toBe("**One:**\n**Two:**");
  });

  it("leaves headers inside fenced code blocks alone", () => {
    const input = "# Real\n```\n# comment\n```\n";
    expect(filterMarkdownHeaders(input)).toBe("**Real:**\n```\n# comment\n```\n");
  });

  it("restores several code blocks in order", () => {
    const input = "```a```\n# H\n```b```";
    expect(filterMarkdownHeaders(input)).toBe("```a```\n**H:**\n```b```");
  });

  it("leaves h3 and deeper untouched", () => {
    expect(filterMarkdownHeaders("### Three")).toBe("### Three");
  });
});

describe("processTextBlock", () => {
  it("is the same function as processMessageContent", () => {
    expect(processMessageContent).toBe(processTextBlock);
  });

  it("returns a text block for prose", () => {
    const blocks = processTextBlock("hello");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].content).toContain("hello");
  });

  it("returns a highlighted code block with its language", () => {
    const blocks = processTextBlock("```sql\nSELECT 1\n```");
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].language).toBe("sql");
    expect(blocks[0].content).toBe("SELECT 1");
    expect(blocks[0].highlightedContent).toContain("hljs-keyword");
  });

  it("strips leading comment lines from a code block", () => {
    const blocks = processTextBlock("```sql\n-- a note\n-- another\nSELECT 1\n```");
    expect(blocks[0].content).toBe("SELECT 1");
  });

  it("still highlights a code block with an unknown language", () => {
    const blocks = processTextBlock("```notalang\nx = 1\n```");
    expect(blocks[0].language).toBe("notalang");
    expect(blocks[0].highlightedContent).toBeTypeOf("string");
  });

  it("interleaves text and code in source order", () => {
    const blocks = processTextBlock("before\n\n```js\nvar a = 1\n```\n\nafter");
    const codeAt = blocks.findIndex((b) => b.type === "code");
    expect(codeAt).toBeGreaterThan(0);
    expect(blocks[0].content).toContain("before");
    expect(blocks[blocks.length - 1].content).toContain("after");
  });

  it("applies the header filter before lexing", () => {
    expect(processTextBlock("# Title")[0].content).toContain("<strong>");
  });
});

describe("renderMarkdown", () => {
  it("honours the gfm line-break option set by the module", () => {
    expect(renderMarkdown("a\nb")).toContain("<br>");
  });
});

describe("formatLogEntryContent", () => {
  it("pretty-prints and class-tags JSON", () => {
    const html = formatLogEntryContent('{"a":"x","b":1,"c":true,"d":null}');
    expect(html).toContain('<span class="json-key">"a":</span>');
    expect(html).toContain('<span class="json-string">"x"</span>');
    expect(html).toContain('<span class="json-number">1</span>');
    expect(html).toContain('<span class="json-boolean">true</span>');
    expect(html).toContain('<span class="json-null">null</span>');
  });

  it("escapes non-JSON text and converts newlines", () => {
    expect(formatLogEntryContent("<b>&x</b>\nnext")).toBe("&lt;b&gt;&amp;x&lt;/b&gt;<br>next");
  });
});

describe("createPreview", () => {
  it("collapses whitespace in plain text", () => {
    expect(createPreview("a   \n  b")).toBe("a b");
  });

  it("truncates past the max length", () => {
    expect(createPreview("x".repeat(50), 10)).toBe("x".repeat(10) + "...");
  });

  it("summarises the first three keys of a JSON object", () => {
    expect(createPreview('{"a":"1","b":2,"c":3,"d":4}', 100)).toBe('{a: "1", b: 2, c: 3, ...}');
  });

  it("truncates long string values inside the key summary", () => {
    expect(createPreview('{"a":"0123456789abc"}', 100)).toBe('{a: "01234567..."}');
  });

  it("falls back to plain text for a JSON scalar", () => {
    expect(createPreview("123")).toBe("123");
  });
});

describe("parseLogEntries", () => {
  it("returns the whole message as one text block when there are no delimiters", () => {
    expect(parseLogEntries("just text")).toEqual([{ type: "text", text: "just text" }]);
  });

  it("returns nothing for empty content", () => {
    expect(parseLogEntries("")).toEqual([]);
  });

  it("splits text around a log entry and keeps order", () => {
    const blocks = parseLogEntries("before\n--- f.log ---\nbody\n--- end ---\nafter");
    expect(blocks.map((b) => b.type)).toEqual(["text", "log_entry", "text"]);
    expect(blocks[0].text).toBe("before");
    expect(blocks[1]).toMatchObject({ filename: "f.log", content: "body", preview: "body" });
    expect(blocks[1].lineStart).toBeUndefined();
    expect(blocks[2].text).toBe("after");
  });

  it("captures the optional line range", () => {
    const blocks = parseLogEntries("--- f.log (lines 3-9) ---\nbody\n--- end ---");
    expect(blocks[0]).toMatchObject({ lineStart: 3, lineEnd: 9 });
  });

  it("parses several entries in one message", () => {
    const one = "--- a ---\nA\n--- end ---";
    const two = "--- b ---\nB\n--- end ---";
    expect(parseLogEntries(`${one}\n${two}`).map((b) => b.type)).toEqual([
      "log_entry",
      "log_entry",
    ]);
  });
});

describe("getLanguageDisplay", () => {
  it("maps known aliases case-insensitively", () => {
    expect(getLanguageDisplay("JS")).toBe("JavaScript");
    expect(getLanguageDisplay("yml")).toBe("YAML");
  });

  it("upper-cases anything unmapped", () => {
    expect(getLanguageDisplay("rust")).toBe("RUST");
  });
});

describe("processHtmlBlock", () => {
  it("swaps pre for the generated-code-block span, keeping attributes", () => {
    expect(processHtmlBlock('<pre class="x">y</pre>')).toBe(
      '<span class="generated-code-block" class="x">y</span>',
    );
  });

  it("strips script tags", () => {
    expect(processHtmlBlock("<script>alert(1)</script>ok")).toBe("ok");
  });
});
