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

import { applyMarkdownFormat, insertAtCaret, renderBannerMarkdown } from "./announcementMarkdown";

const parse = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};

describe("renderBannerMarkdown", () => {
  it("renders the supported inline formatting", () => {
    const html = renderBannerMarkdown("**bold** _italic_ `code` ~~gone~~");

    expect(html).toBe("<strong>bold</strong> <em>italic</em> <code>code</code> <del>gone</del>");
  });

  it("renders http(s) links that open in a new tab without an opener", () => {
    const link = parse(
      renderBannerMarkdown("[Status](https://status.example.com?a=1&b=2)"),
    ).querySelector("a")!;

    expect(link.getAttribute("href")).toBe("https://status.example.com?a=1&b=2");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps message text as a single inline run, never block markup", () => {
    const html = renderBannerMarkdown("# Heading\n\n- item");

    expect(parse(html).querySelector("h1, ul, li, p")).toBeNull();
  });

  it("returns an empty string for an empty message", () => {
    expect(renderBannerMarkdown("")).toBe("");
    expect(renderBannerMarkdown(undefined)).toBe("");
  });

  describe("XSS", () => {
    it("shows a script tag as text instead of running it", () => {
      const host = parse(renderBannerMarkdown("hi <script>alert(1)</script>"));

      expect(host.querySelector("script")).toBeNull();
      expect(host.textContent).toContain("<script>alert(1)</script>");
    });

    it("strips javascript: links", () => {
      const host = parse(renderBannerMarkdown("[click](javascript:alert(1))"));

      expect(host.innerHTML).not.toContain("javascript:");
      expect(host.querySelector("a")?.hasAttribute("href") ?? false).toBe(false);
    });

    it("strips non-http schemes such as data: and mailto:", () => {
      for (const href of ["data:text/html,<b>x</b>", "mailto:a@b.c", "/relative"]) {
        const link = parse(renderBannerMarkdown(`[x](${href})`)).querySelector("a");
        expect(link?.hasAttribute("href") ?? false).toBe(false);
      }
    });

    it("never produces an element carrying an event handler", () => {
      const host = parse(renderBannerMarkdown('<img src=x onerror="alert(1)"> **ok**'));

      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("[onerror]")).toBeNull();
      expect(host.querySelector("strong")?.textContent).toBe("ok");
    });

    it("shows raw HTML as text rather than markup", () => {
      const host = parse(renderBannerMarkdown('<a href="https://x.dev" onclick="x()">raw</a>'));

      expect(host.querySelector("a")).toBeNull();
      expect(host.textContent).toContain('<a href="https://x.dev" onclick="x()">raw</a>');
    });

    it("drops attributes outside the allowlist from markdown links", () => {
      const host = parse(renderBannerMarkdown('[x](https://x.dev "title")'));

      expect(host.querySelector("a")?.hasAttribute("title")).toBe(false);
    });
  });

  it("does not change how the shared marked instance treats raw HTML", () => {
    renderBannerMarkdown("<b>x</b>");

    expect(marked.parseInline("<b>x</b>")).toBe("<b>x</b>");
  });
});

describe("applyMarkdownFormat", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(applyMarkdownFormat("make this loud", 5, 9, "bold")).toEqual({
      value: "make **this** loud",
      selectionStart: 7,
      selectionEnd: 11,
    });
    expect(applyMarkdownFormat("a b", 2, 3, "italic").value).toBe("a _b_");
    expect(applyMarkdownFormat("run ls", 4, 6, "code").value).toBe("run `ls`");
  });

  it("inserts empty markers at the caret and places the caret between them", () => {
    expect(applyMarkdownFormat("ab", 1, 1, "bold")).toEqual({
      value: "a****b",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("turns a selection into a link with the caret after the URL scheme", () => {
    const result = applyMarkdownFormat("see docs", 4, 8, "link");

    expect(result.value).toBe("see [docs](https://)");
    expect(result.selectionStart).toBe(result.value.length - 1);
  });

  it("inserts an empty link with the caret in the link text", () => {
    expect(applyMarkdownFormat("", 0, 0, "link")).toEqual({
      value: "[](https://)",
      selectionStart: 1,
      selectionEnd: 1,
    });
  });
});

describe("insertAtCaret", () => {
  it("replaces the selection and moves the caret past the insert", () => {
    expect(insertAtCaret("hello world", 6, 11, "🎉")).toEqual({
      value: "hello 🎉",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });
});
