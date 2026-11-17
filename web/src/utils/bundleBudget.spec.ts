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

import { checkBundleBudget, entryAssets } from "./bundleBudget";

const html = (...tags: string[]) => `<html><head>${tags.join("")}</head><body></body></html>`;
const script = (src: string) => `<script type="module" crossorigin src="${src}"></script>`;
const preload = (href: string) => `<link rel="modulepreload" crossorigin href="${href}">`;
const style = (href: string) => `<link rel="stylesheet" crossorigin href="${href}">`;

describe("entryAssets", () => {
  it("collects module scripts, modulepreloads and stylesheets once each", () => {
    const page = html(
      script("./assets/index.a.js"),
      preload("./assets/vendor/o2cs-luxon.b.js"),
      preload("./assets/vendor/o2cs-luxon.b.js"),
      style("./assets/index.c.css"),
    );
    expect(entryAssets(page)).toEqual([
      "./assets/index.a.js",
      "./assets/vendor/o2cs-luxon.b.js",
      "./assets/index.c.css",
    ]);
  });

  it("matches upper-case tags and attributes", () => {
    const page = html(
      '<SCRIPT TYPE="module" SRC="./assets/index.a.js"></SCRIPT>',
      '<LINK REL="modulepreload" HREF="./assets/echarts.b.js">',
    );
    expect(entryAssets(page)).toEqual(["./assets/index.a.js", "./assets/echarts.b.js"]);
  });

  it("ignores icons, font preloads and classic scripts", () => {
    const page = html(
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="preload" as="font" href="./assets/Geist.woff2">',
      "<script>window.global = window;</script>",
    );
    expect(entryAssets(page)).toEqual([]);
  });
});

describe("checkBundleBudget", () => {
  const size = () => 100;

  it("passes a lean entry under budget", () => {
    const result = checkBundleBudget(html(script("./assets/index.a.js")), size, 1000);
    expect(result).toMatchObject({ forbidden: [], gzipBytes: 100, overBudget: false });
  });

  it.each(["monaco-editor", "highlight.js", "gridstack", "echarts"])(
    "flags a preloaded %s chunk",
    (name) => {
      const page = html(script("./assets/index.a.js"), preload(`./assets/${name}.x.js`));
      expect(checkBundleBudget(page, size, 1000).forbidden).toEqual([`./assets/${name}.x.js`]);
    },
  );

  it("fails when the combined gzip size passes the budget", () => {
    const page = html(script("./assets/index.a.js"), preload("./assets/b.js"));
    expect(checkBundleBudget(page, size, 150)).toMatchObject({ gzipBytes: 200, overBudget: true });
  });
});
