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
import { marked } from "marked";
import { extractRcaToc, renderRcaReport, stripVerdictFence } from "./rcaReportMarkdown";

const toDom = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};

const VERDICT_REPORT = [
  "## Root Cause",
  "",
  "The ingester ran out of memory.",
  "",
  "```json verdict",
  '{"action": "suppress", "confidence": "high"}',
  "```",
].join("\n");

describe("rcaReportMarkdown", () => {
  it("renders inline code verbatim, including angle brackets", () => {
    const dom = toDom(renderRcaReport("Run `kubectl -n checkout logs <pod-name>` next."));
    const code = dom.querySelector("code");
    expect(code?.textContent).toBe("kubectl -n checkout logs <pod-name>");
  });

  it("renders fenced code verbatim without creating elements from it", () => {
    const md = ["```rust", "let v: Vec<String> = vec![];", "<div>not markup</div>", "```"].join(
      "\n",
    );
    const dom = toDom(renderRcaReport(md));
    const code = dom.querySelector("pre code");
    expect(code?.textContent).toContain("Vec<String>");
    expect(code?.textContent).toContain("<div>not markup</div>");
    expect(code?.querySelector("div")).toBeNull();
    expect(
      Array.from(dom.querySelectorAll("div")).some((d) => d.textContent === "not markup"),
    ).toBe(false);
  });

  it("renders links as plain text with the target shown", () => {
    const html = renderRcaReport("See [logs](https://evil.example) now.");
    expect(html).not.toContain("<a");
    expect(toDom(html).textContent).toContain("logs (https://evil.example)");
  });

  it("renders a link whose text equals its href once", () => {
    const html = renderRcaReport("See https://evil.example now.");
    expect(html).not.toContain("<a");
    expect(toDom(html).textContent?.split("https://evil.example").length).toBe(2);
  });

  it("removes the json verdict fence from the report", () => {
    expect(stripVerdictFence(VERDICT_REPORT)).not.toMatch(/verdict|suppress/);
    const text = toDom(renderRcaReport(VERDICT_REPORT)).textContent ?? "";
    expect(text).toContain("The ingester ran out of memory.");
    expect(text).not.toMatch(/verdict|suppress|confidence/);
  });

  it("renders deterministically and leaves global marked defaults untouched", () => {
    const defaultsBefore = marked.getDefaults();
    const rendererBefore = marked.defaults.renderer;
    const first = renderRcaReport(VERDICT_REPORT);
    const second = renderRcaReport(VERDICT_REPORT);
    expect(second).toBe(first);
    expect(marked.defaults.renderer).toBe(rendererBefore);
    expect(marked.getDefaults()).toEqual(defaultsBefore);
  });

  it("gives TOC ids equal to the rendered h2/h3 heading ids", () => {
    const md = "## Root Cause\n\ntext\n\n### Contributing factors\n\n#### Detail\n\n## Next Steps";
    const toc = extractRcaToc(md);
    const rendered = Array.from(
      toDom(renderRcaReport(md)).querySelectorAll(".rca-h2, .rca-h3"),
    ).map((el) => el.id);
    expect(toc.map((e) => e.id)).toEqual(rendered);
    expect(toc.map((e) => e.level)).toEqual([2, 3, 2]);
  });

  it("strips script tags from model output", () => {
    const html = renderRcaReport('<script>alert("xss")</script>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain('alert("xss")');
  });

  it("turns three or more key/value list items into a table", () => {
    const md = "- **Severity**: P2\n- **Service**: ingester\n- **Region**: us-east";
    const dom = toDom(renderRcaReport(md));
    const cells = Array.from(dom.querySelectorAll("tbody td")).map((td) => td.textContent);
    expect(cells).toEqual(["Severity", "P2", "Service", "ingester", "Region", "us-east"]);
  });

  it("renders raw block and inline HTML as visible text without styles or classes", () => {
    const md = [
      '<div style="position:fixed;inset:0;z-index:99999">x</div>',
      "",
      'Inline <span class="fixed inset-0">y</span> here.',
    ].join("\n");
    const dom = toDom(renderRcaReport(md));
    const text = dom.textContent ?? "";
    expect(text).toContain('<div style="position:fixed;inset:0;z-index:99999">x</div>');
    expect(text).toContain('<span class="fixed inset-0">y</span>');
    expect(dom.querySelector("[style]")).toBeNull();
    expect(dom.querySelector(".fixed")).toBeNull();
  });

  it("keeps key/value lists inside fenced and indented code as code", () => {
    const kv = ["- **Severity**: P2", "- **Service**: ingester", "- **Region**: us-east"];
    const cases = [
      ["```", ...kv, "```"].join("\n"),
      ["~~~", ...kv, "~~~"].join("\n"),
      ["Intro paragraph.", "", ...kv.map((l) => `    ${l}`)].join("\n"),
    ];
    for (const md of cases) {
      const dom = toDom(renderRcaReport(md));
      expect(dom.querySelector("table")).toBeNull();
      expect(dom.querySelector("pre code")?.textContent).toContain("- **Service**: ingester");
    }
  });

  it("keeps a pipe inside inline code in a key/value table cell", () => {
    const md = [
      "- **Severity**: P2",
      "- **Query**: `level=error | count`",
      "- **Region**: us-east",
    ].join("\n");
    const dom = toDom(renderRcaReport(md));
    const rows = Array.from(dom.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(3);
    const cells = Array.from(rows[1].querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["Query", "level=error | count"]);
  });

  it("removes an unterminated trailing verdict fence entirely", () => {
    const md = 'Body text.\n\n```json verdict\n{"action": "suppress", "confidence": "high"}';
    const text = toDom(renderRcaReport(md)).textContent ?? "";
    expect(text).toContain("Body text.");
    expect(text).not.toMatch(/verdict|suppress|confidence|\{/);
  });

  it("removes a verdict fence whose JSON contains backticks entirely", () => {
    const md = [
      "Body text.",
      "",
      "```json verdict",
      '{"action": "suppress", "reason": "see ``` in logs", "confidence": "high"}',
      "```",
    ].join("\n");
    const text = toDom(renderRcaReport(md)).textContent ?? "";
    expect(text).toContain("Body text.");
    expect(text).not.toMatch(/verdict|suppress|confidence|in logs|\{/);
  });

  it("keeps a plain json fence", () => {
    const md = 'Body.\n\n```json\n{"pod": "ingester-0"}\n```';
    expect(toDom(renderRcaReport(md)).querySelector("pre code")?.textContent).toContain(
      '"pod": "ingester-0"',
    );
  });

  it("promotes standalone bold lines to sections, but not inside code or glued lines", () => {
    const md = [
      "**Incident Details**",
      "",
      "**Evidence:**",
      "",
      "The ingester restarted.",
      "**Inline label**",
      "",
      "```",
      "**not a heading**",
      "```",
      "",
      "__Executive Summary__",
    ].join("\n");
    expect(extractRcaToc(md).map((e) => e.text)).toEqual([
      "Incident Details",
      "Evidence",
      "Executive Summary",
    ]);
    expect(toDom(renderRcaReport(md)).querySelector("pre code")?.textContent).toContain(
      "**not a heading**",
    );
  });

  it("keeps bold sub-labels when the report already has sections", () => {
    const md = "## Root Cause\n\n**Timeline:**\n\n- 10:02 restart\n\n### Contributing factors";
    expect(extractRcaToc(md).map((e) => e.text)).toEqual(["Root Cause", "Contributing factors"]);
    expect(renderRcaReport(md)).not.toContain('id="section-timeline"');
  });
});
