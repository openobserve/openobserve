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
import { CLOSED_TOKEN_RE, OPEN_TOKEN_RE, openTokenAt, tokenAtCaret } from "./useTemplateSuggest";

describe("CLOSED_TOKEN_RE", () => {
  function names(text: string) {
    return Array.from(text.matchAll(CLOSED_TOKEN_RE), (found) => found[1]);
  }

  it("captures every closed token in order", () => {
    expect(names("{{a}} and {{b_2}}")).toEqual(["a", "b_2"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(names("{{ context }}")).toEqual(["context"]);
  });

  it("ignores malformed tokens", () => {
    expect(names("{{1bad}} {single} {{ }} {{open")).toEqual([]);
  });
});

describe("OPEN_TOKEN_RE", () => {
  it("captures the query typed after an open {{", () => {
    expect(OPEN_TOKEN_RE.exec("see {{ba")?.[1]).toBe("ba");
  });

  it("captures an empty query on a bare {{", () => {
    expect(OPEN_TOKEN_RE.exec("{{")?.[1]).toBe("");
  });

  it("allows a space after the braces", () => {
    expect(OPEN_TOKEN_RE.exec("{{ ba")?.[1]).toBe("ba");
  });

  it("rejects a closed token and text that ends elsewhere", () => {
    expect(OPEN_TOKEN_RE.exec("{{ba}}")).toBeNull();
    expect(OPEN_TOKEN_RE.exec("{{ba and")).toBeNull();
  });
});

describe("openTokenAt", () => {
  it("anchors the query and start to the caret, so a later {{ wins", () => {
    expect(openTokenAt("{{a}} {{b", 9)).toEqual({ query: "b", start: 6 });
  });

  it("returns null once the caret sits before the braces", () => {
    expect(openTokenAt("abc {{ba", 2)).toBeNull();
  });
});

describe("tokenAtCaret", () => {
  it("names the token the caret sits inside", () => {
    expect(tokenAtCaret("Hello {{input}}!", 10)).toBe("input");
  });

  it("matches at either edge of the token", () => {
    expect(tokenAtCaret("{{input}}", 0)).toBe("input");
    expect(tokenAtCaret("{{input}}", 9)).toBe("input");
  });

  it("returns null outside any token", () => {
    expect(tokenAtCaret("Hello {{input}}!", 2)).toBeNull();
  });

  it("returns null when there is no token at all", () => {
    expect(tokenAtCaret("Hello!", 3)).toBeNull();
  });

  it("picks the token the caret is actually inside, among several", () => {
    expect(tokenAtCaret("{{a}} {{b}} {{c}}", 8)).toBe("b");
  });

  it("is stateless across calls despite the global flag", () => {
    expect(tokenAtCaret("{{a}} {{b}}", 8)).toBe("b");
    expect(tokenAtCaret("{{a}} {{b}}", 1)).toBe("a");
  });
});
