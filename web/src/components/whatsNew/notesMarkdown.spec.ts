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

import { renderNotes, renderNotesInline } from "./notesMarkdown";

describe("renderNotes", () => {
  it("renders the markdown a highlight actually uses", () => {
    const html = renderNotes(
      ["Page on **burn rate**.", "", "- One", "- Two", "", "Lives under `Alerts`."].join("\n"),
    );

    expect(html).toContain("<strong>burn rate</strong>");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<code>Alerts</code>");
  });

  it("renders a fenced code block", () => {
    expect(renderNotes(["```hcl", 'name = "x"', "```"].join("\n"))).toContain("<pre>");
  });

  it("returns nothing for empty or blank input", () => {
    expect(renderNotes("")).toBe("");
    expect(renderNotes("   \n  ")).toBe("");
  });

  // The manifest is fetched content, so this is the boundary that matters.
  it("strips script tags and inline event handlers", () => {
    const html = renderNotes('Hi <script>alert(1)</script><img src="x" onerror="alert(2)">');

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("drops a javascript: link target", () => {
    expect(renderNotes("[click](javascript:alert(1))")).not.toContain("javascript:");
  });

  // A docs link must not navigate the dialog's own frame away from the product.
  it("forces links to open out-of-app", () => {
    const html = renderNotes("[docs](https://openobserve.ai/docs/)");

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("renderNotesInline", () => {
  it("emits no wrapping paragraph", () => {
    const html = renderNotesInline("Group by **service**");

    expect(html).toContain("<strong>service</strong>");
    expect(html).not.toContain("<p>");
  });

  it("sanitizes the same way as the block renderer", () => {
    expect(renderNotesInline("<script>alert(1)</script>ok")).not.toContain("<script");
  });
});
