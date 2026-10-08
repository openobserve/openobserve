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
import { resolveRelativeLinks } from "@/utils/rum/sessionReplayUrls";

const PAGE = "https://app.example.com/#/appointments";

const link = (href: string | undefined, extra: Record<string, any> = {}) => ({
  type: 2,
  tagName: "link",
  attributes: { rel: "stylesheet", ...(href === undefined ? {} : { href }), ...extra },
  childNodes: [],
  id: 5,
});

const snapshot = (...headChildren: any[]) => ({
  type: 0,
  id: 1,
  childNodes: [
    {
      type: 2,
      tagName: "html",
      id: 2,
      attributes: {},
      childNodes: [{ type: 2, tagName: "head", id: 3, attributes: {}, childNodes: headChildren }],
    },
  ],
});

const headOf = (node: any) => node.childNodes[0].childNodes[0].childNodes;

describe("resolveRelativeLinks", () => {
  it("resolves a root-relative stylesheet href in a full snapshot against the page", () => {
    const node = snapshot(link("/assets/Appointments.1db46064.css"));
    resolveRelativeLinks(node, PAGE);
    expect(headOf(node)[0].attributes.href).toBe(
      "https://app.example.com/assets/Appointments.1db46064.css",
    );
  });

  it("resolves a document-relative href against the page path", () => {
    const node = link("styles/app.css");
    resolveRelativeLinks(node, "https://app.example.com/web/index.html");
    expect(node.attributes.href).toBe("https://app.example.com/web/styles/app.css");
  });

  it("resolves a link added by a mutation", () => {
    const node = link("/assets/SelectInput.e6555040.css");
    resolveRelativeLinks(node, PAGE);
    expect(node.attributes.href).toBe("https://app.example.com/assets/SelectInput.e6555040.css");
  });

  it("leaves absolute, data and fragment hrefs unchanged", () => {
    for (const href of ["https://cdn.example.com/a.css", "data:text/css,a{}", "#top"]) {
      const node = link(href);
      resolveRelativeLinks(node, PAGE);
      expect(node.attributes.href).toBe(href);
    }
  });

  it("keeps the recorded _cssText alongside the resolved href", () => {
    const node = link("/assets/index.css", { _cssText: "a { color: red; }" });
    resolveRelativeLinks(node, PAGE);
    expect(node.attributes).toMatchObject({
      href: "https://app.example.com/assets/index.css",
      _cssText: "a { color: red; }",
    });
  });

  it("does nothing without an http(s) page URL", () => {
    for (const page of [undefined, "", "about:blank", "not a url"]) {
      const node = link("/assets/a.css");
      resolveRelativeLinks(node, page);
      expect(node.attributes.href).toBe("/assets/a.css");
    }
  });

  it("ignores non-link elements and links without an href", () => {
    const img = { type: 2, tagName: "img", attributes: { src: "/a.png" }, childNodes: [], id: 9 };
    const bare = link(undefined);
    resolveRelativeLinks(snapshot(img, bare), PAGE);
    expect(img.attributes.src).toBe("/a.png");
    expect(bare.attributes).not.toHaveProperty("href");
  });
});
