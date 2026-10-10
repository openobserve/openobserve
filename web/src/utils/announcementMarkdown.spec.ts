// @vitest-environment jsdom
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
  applyMessageFormat,
  bannerMessageText,
  insertAtCaret,
  renderBannerMessage,
} from "./announcementMarkdown";

describe("renderBannerMessage", () => {
  it("renders inline emphasis, code and links", () => {
    expect(renderBannerMessage("**Bold** _it_ `code`")).toBe(
      "<strong>Bold</strong> <em>it</em> <code>code</code>",
    );
    expect(renderBannerMessage("[Status](https://status.example.com)")).toBe(
      '<a href="https://status.example.com" target="_blank" rel="noopener noreferrer">Status</a>',
    );
  });

  it("keeps a message on one line", () => {
    expect(renderBannerMessage("one\ntwo")).toBe("one two");
    expect(renderBannerMessage("# Heading")).not.toContain("<h1");
  });

  it("strips scripts, handlers and raw HTML", () => {
    for (const attack of [
      "<script>alert(1)</script>hi",
      '<img src=x onerror="alert(1)">',
      '<a href="https://x.dev" onclick="alert(1)">x</a>',
      "<iframe src='https://evil.dev'></iframe>",
      "<div style='position:fixed'>x</div>",
    ]) {
      const html = renderBannerMessage(attack);
      expect(html, attack).not.toMatch(/<script|onerror|onclick|<img|<iframe|<div|style=/i);
    }
  });

  it("drops links that are not http(s), keeping their text", () => {
    expect(renderBannerMessage("[click](javascript:alert(1))")).toBe("click");
    expect(renderBannerMessage("[mail](mailto:a@b.dev)")).toBe("mail");
  });
});

describe("bannerMessageText", () => {
  it("returns the readable text without markup", () => {
    expect(bannerMessageText("**Down** see [status](https://s.dev)")).toBe("Down see status");
  });
});

describe("applyMessageFormat", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(applyMessageFormat("go now", 3, 6, "bold", "text")).toEqual({
      value: "go **now**",
      selectionStart: 5,
      selectionEnd: 8,
    });
  });

  it("inserts a selected placeholder when nothing is selected", () => {
    expect(applyMessageFormat("a ", 2, 2, "code", "text")).toEqual({
      value: "a `text`",
      selectionStart: 3,
      selectionEnd: 7,
    });
  });

  it("builds a link and selects its URL for typing", () => {
    const result = applyMessageFormat("see docs", 4, 8, "link", "text");
    expect(result.value).toBe("see [docs](https://)");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("https://");
  });
});

describe("insertAtCaret", () => {
  it("replaces the selection and moves the caret after the insert", () => {
    expect(insertAtCaret("ab", 1, 1, "🚨")).toEqual({
      value: "a🚨b",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });
});
