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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({
  onMessage: null as null | ((event: any) => void),
  posted: [] as any[],
}));

const proxyUrl = "https://api.test/proxy/org";

function rewrite(cssString: string): string {
  worker.onMessage!({ data: { cssString, proxyUrl, id: 1 } });
  return worker.posted[worker.posted.length - 1].updatedCssString;
}

describe("rumcssworker", () => {
  beforeAll(async () => {
    vi.stubGlobal("self", {
      addEventListener: (_type: string, handler: (event: any) => void) => {
        worker.onMessage = handler;
      },
      postMessage: (message: any) => worker.posted.push(message),
    });
    await import("./rumcssworker.js");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("proxies an absolute url", () => {
    expect(rewrite('a{background:url("https://cdn.test/a.png")}')).toBe(
      `a{background:url("${proxyUrl}/https://cdn.test/a.png")}`,
    );
  });

  it("leaves an already proxied url alone, so a second pass is a no-op", () => {
    const once = rewrite("a{background:url(https://cdn.test/a.png)}");
    expect(rewrite(once)).toBe(once);
  });

  it("keeps excluded font hosts unproxied", () => {
    const css = 'a{src:url("https://fonts.gstatic.com/x.woff2")}';
    expect(rewrite(css)).toBe(css);
  });
});
